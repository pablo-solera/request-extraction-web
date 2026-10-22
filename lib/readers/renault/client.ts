import "server-only";

import {
  renaultCreateResponseSchema,
  renaultOptionsSchema,
  renaultStateSchema,
} from "@/lib/readers/renault/types";
import { ReaderError } from "@/lib/readers/errors";
import { z } from "zod";

export { ReaderError } from "@/lib/readers/errors";

const REQUEST_TIMEOUT_MS = 12_000;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new ReaderError("La integración con Renault no está configurada correctamente.", "READER_CONFIGURATION_ERROR", false, 500);
  }

  return value;
}

function readerBaseUrl() {
  const url = new URL(requiredEnvironment("RENAULT_READER_BASE_URL"));
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) {
    throw new ReaderError(
      "La conexion con Renault debe usar HTTPS fuera del equipo local.",
      "READER_CONFIGURATION_ERROR",
      false,
      500,
    );
  }

  return url;
}

function readerUrl(path: string) {
  return new URL(path, readerBaseUrl()).toString();
}

async function readError(response: Response) {
  try {
    const value = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof value.error === "string") return value.error;
    if (value.error && typeof value.error === "object" && "message" in value.error && typeof value.error.message === "string") return value.error.message;
    if (typeof value.message === "string") return value.message;
    return null;
  } catch {
    return null;
  }
}

async function request(path: string, init?: RequestInit) {
  let response: Response;

  try {
    response = await fetch(readerUrl(path), {
      ...init,
      cache: "no-store",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ReaderError(
      "El servicio de Renault no esta disponible.",
      "READER_UNAVAILABLE",
      true,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ReaderError("El reader ha devuelto una redirección no permitida.", "INVALID_READER_REDIRECT", false);
  }

  if (!response.ok) {
    const upstreamError = await readError(response);
    const duplicate = response.status === 400 && /duplicate|already|duplicad/i.test(upstreamError ?? "");
    const notFound = response.status === 404;

    const conflict = response.status === 409;
    throw new ReaderError(
      duplicate
        ? "Ya existe una extracción Renault igual en curso."
        : notFound
          ? "El trabajo de Renault ya no está disponible."
          : conflict
            ? upstreamError ?? "La petición no admite esta acción en su estado actual."
          : "Renault no ha aceptado la solicitud.",
      duplicate ? "DUPLICATE_EXPORT" : notFound ? "JOB_NOT_FOUND" : conflict ? "READER_CONFLICT" : "READER_REQUEST_FAILED",
      response.status >= 500,
      duplicate ? 409 : notFound ? 404 : conflict ? 409 : response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }

  return response;
}

export function getRenaultSettings() {
  return {
    format: requiredEnvironment("RENAULT_READER_FORMAT"),
    language: requiredEnvironment("RENAULT_READER_LANGUAGE").toLowerCase(),
    range: requiredEnvironment("RENAULT_READER_RANGE"),
  };
}

const readerCoreInfoSchema = z.object({
  capabilities: z.object({
    labours: z.object({ create: z.boolean(), list: z.boolean(), cancel: z.boolean(), resume: z.boolean(), download: z.boolean() }),
    models: z.object({ options: z.boolean() }),
  }),
});
export type RenaultReaderCapabilities = z.infer<typeof readerCoreInfoSchema>["capabilities"]["labours"];
let readerCoreCapabilitiesCache: { expiresAt: number; capabilities: RenaultReaderCapabilities | null } | undefined;
let readerCoreModelOptionsAvailable = false;

export async function getRenaultReaderCapabilities(): Promise<RenaultReaderCapabilities | null> {
  if (readerCoreCapabilitiesCache && readerCoreCapabilitiesCache.expiresAt > Date.now()) return readerCoreCapabilitiesCache.capabilities;
  let capabilities: RenaultReaderCapabilities | null = null;
  try {
    const response = await request("/v1/info");
    const info = readerCoreInfoSchema.parse(await response.json());
    capabilities = info.capabilities.labours;
    readerCoreModelOptionsAvailable = info.capabilities.models.options;
  } catch (error) {
    readerCoreModelOptionsAvailable = false;
    if (!(error instanceof ReaderError && error.status === 404)) console.warn("Renault Reader Core capabilities are not available yet.");
  }
  readerCoreCapabilitiesCache = { capabilities, expiresAt: Date.now() + 60_000 };
  return capabilities;
}

export async function getRenaultLabourFamilies(brand: "Renault" | "Dacia") {
  if (await getRenaultReaderCapabilities() && readerCoreModelOptionsAvailable) {
    const query = new URLSearchParams({ manufacturer: "Renault", brand });
    const response = await request(`/v1/models/options?${query}`);
    const result = z.object({
      filters: z.array(z.object({ name: z.string(), values: z.array(z.object({ value: z.string(), label: z.string().optional() })) })),
      models: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
    }).parse(await response.json());
    const familyFilter = result.filters.find((filter) => ["family", "families", "familycode", "vehiclefamily"].includes(filter.name.toLowerCase()));
    const options = familyFilter?.values.map((option) => ({ value: option.value, label: option.label || option.value }))
      ?? result.models?.map((model) => ({ value: model.id, label: model.label || model.id }))
      ?? [];
    if (options.length === 0) throw new ReaderError(`No hay familias disponibles para ${brand}.`, "NO_MODEL_OPTIONS", false, 404);
    return [...new Map(options.map((option) => [option.value, { value: option.value, label: option.label || option.value }])).values()];
  }
  const settings = getRenaultSettings();
  const families = (await getRenaultLabourOptions(settings.range)).families;
  const hasBrandMetadata = families.some((option) => Boolean(option.brand));
  const options = hasBrandMetadata
    ? families.filter((option) => !option.brand || option.brand.toLocaleLowerCase("es-ES") === brand.toLocaleLowerCase("es-ES"))
    : families;
  if (options.length === 0) throw new ReaderError(`No hay familias disponibles para ${brand}.`, "NO_MODEL_OPTIONS", false, 404);
  return [...new Map(options.map((option) => [option.value, { value: option.value, label: option.label || option.value }])).values()];
}

export async function cancelRenaultLabour(requestId: string) {
  if (!(await getRenaultReaderCapabilities())?.cancel) throw new ReaderError("Renault todavía no ofrece la cancelación mediante el contrato /v1.", "ACTION_NOT_SUPPORTED", false, 501);
  const id = z.uuid().parse(requestId);
  const response = await request(`/v1/labours/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
  const parsed = z.object({ requestId: z.uuid(), status: z.enum(["cancelled", "cancelling"]) }).parse(await response.json());
  return parsed;
}

export async function resumeRenaultLabour(requestId: string, force = false) {
  if (!(await getRenaultReaderCapabilities())?.resume) throw new ReaderError("Renault todavía no ofrece la reanudación mediante el contrato /v1.", "ACTION_NOT_SUPPORTED", false, 501);
  const id = z.uuid().parse(requestId);
  const response = await request(`/v1/labours/${encodeURIComponent(id)}/resume`, { method: "POST", body: JSON.stringify({ force }) });
  return { ...z.object({ requestId: z.uuid() }).passthrough().parse(await response.json()), status: "queued" };
}

async function getRenaultLabourOptions(range: string) {
  const optionsResponse = await request("/labours/options", {
    method: "POST",
    body: JSON.stringify({ range }),
  });
  return renaultOptionsSchema.parse(await optionsResponse.json());
}

export async function createRenaultLabour(input: {
  family: string;
  brand?: string;
  options?: Awaited<ReturnType<typeof getRenaultLabourOptions>>;
  axCode?: string;
  edition?: string;
  language?: string;
  format?: string;
  range?: string;
}) {
  const capabilities = await getRenaultReaderCapabilities();
  if (capabilities?.create) {
    const response = await request("/v1/labours", {
      method: "POST",
      body: JSON.stringify({
        manufacturer: input.brand || "Renault",
        ...(input.axCode ? { axCode: input.axCode } : {}),
        ...(input.edition ? { edition: input.edition.replace("/", "_") } : {}),
        ...(input.language ? { language: input.language } : {}),
        selection: { family: input.family, ...(input.format ? { format: input.format } : {}), ...(input.range ? { range: input.range } : {}) },
      }),
    });
    return renaultCreateResponseSchema.parse(await response.json());
  }
  const settings = getRenaultSettings();
  const options = input.options ?? await getRenaultLabourOptions(settings.range);
  const family = options.families.find(
    (item) =>
      item.value.toLocaleLowerCase() === input.family.toLocaleLowerCase() ||
      item.label.toLocaleLowerCase() === input.family.toLocaleLowerCase(),
  );
  const format = options.formats.find(
    (item) => item.toLocaleLowerCase() === settings.format.toLocaleLowerCase(),
  );
  const language = options.languages?.find(
    (item) => item.toLocaleLowerCase() === settings.language,
  );

  if (!family) {
    throw new ReaderError("La family indicada no esta disponible en Renault.", "INVALID_FAMILY", false, 400);
  }

  if (!format || !language) {
    throw new ReaderError(
      "El formato o idioma configurado no esta disponible en Renault.",
      "INVALID_READER_CONFIGURATION",
      false,
      500,
    );
  }

  const response = await request("/labours", {
    method: "POST",
    body: JSON.stringify({
      family: family.value,
      format,
      language,
      range: settings.range,
    }),
  });

  return renaultCreateResponseSchema.parse(await response.json());
}

export { getRenaultLabourOptions };

export async function getRenaultLabourState(requestId: string) {
  const id = z.uuid().parse(requestId);
  if (await getRenaultReaderCapabilities()) {
    const response = await request(`/v1/labours/${encodeURIComponent(id)}`);
    return renaultStateSchema.parse(await response.json());
  }
  const response = await request(`/labours/${encodeURIComponent(requestId)}`);
  return renaultStateSchema.parse(await response.json());
}

export async function getRenaultDownloadLocation(requestId: string) {
  const id = z.uuid().parse(requestId);
  const capabilities = await getRenaultReaderCapabilities();
  if (capabilities && !capabilities.download) throw new ReaderError("Este reader no ofrece la descarga de extracciones.", "ACTION_NOT_SUPPORTED", false, 501);
  const useReaderCore = Boolean(capabilities?.download);
  let response: Response;

  try {
    response = await fetch(readerUrl(`${useReaderCore ? "/v1" : ""}/labours/${encodeURIComponent(id)}/download`), {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ReaderError("No se ha podido preparar la descarga.", "READER_UNAVAILABLE", true);
  }

  if (response.status === 409) {
    throw new ReaderError("La extracción todavía no está disponible.", "JOB_NOT_READY", true, 409);
  }

  if (response.status !== 307) {
    throw new ReaderError("No se ha podido preparar la descarga.", "DOWNLOAD_UNAVAILABLE", true);
  }

  const location = response.headers.get("location");
  const allowedOrigin = new URL(requiredEnvironment("RENAULT_READER_DOWNLOAD_ORIGIN")).origin;

  if (!location) {
    throw new ReaderError("El reader no ha devuelto una descarga.", "DOWNLOAD_UNAVAILABLE", true);
  }

  const url = new URL(location);

  if (url.protocol !== "https:" || url.origin !== allowedOrigin) {
    throw new ReaderError("El destino de descarga no es valido.", "INVALID_DOWNLOAD_LOCATION", false);
  }

  return url;
}
