import "server-only";

import { ReaderError } from "@/lib/readers/errors";
import { isTrustedServiceUrl } from "@/lib/readers/service-url";
import { bmwLoadSelection, createBody, transformerDefinitions, type TransformerKey } from "@/lib/transformer/registry";
import {
  transformerEnqueuedSchema, transformerInfoSchema, transformerStateSchema,
  type TransformerComparisonInput, type TransformerLoadInput, type TransformerReportInput, type TransformerResource, type TransformerState,
} from "@/lib/transformer/types";

const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const CAPABILITIES_TTL_MS = 60_000;
export const MAX_LST_BYTES = 25 * 1024 * 1024;

type UpstreamError = { code: string | null; message: string | null; details: unknown };

async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxBytes) throw new Error("response-too-large");
  return JSON.parse(text) as unknown;
}

/** Reads the shared `{ error: { code, message, details } }` body; anything else is ignored on purpose. */
async function upstreamError(response: Response): Promise<UpstreamError> {
  try {
    const body = await readJsonBounded(response, 16 * 1024);
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    if (error && typeof error === "object") {
      const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
      return { code: typeof code === "string" ? code : null, message: typeof message === "string" ? message : null, details };
    }
  } catch { /* details are intentionally discarded */ }
  return { code: null, message: null, details: undefined };
}

function missingTypekeys(details: unknown): string[] {
  const found = Array.isArray(details) ? details : details && typeof details === "object"
    ? Object.values(details as Record<string, unknown>).find(Array.isArray)
    : undefined;
  const list: unknown[] = Array.isArray(found) ? found : [];
  return list.flatMap((item) => {
    if (typeof item === "string") return [item];
    const typekey = item && typeof item === "object" ? (item as { typekey?: unknown }).typekey : undefined;
    return typeof typekey === "string" ? [typekey] : [];
  }).slice(0, 20);
}

function notAvailableMessage(details: unknown) {
  const missing = missingTypekeys(details);
  return missing.length > 0
    ? `Faltan datos extraídos para cargar la solicitud (typekeys: ${missing.join(", ")}). Vuelve a extraerlos e inténtalo de nuevo.`
    : "Faltan datos extraídos para cargar la solicitud. Vuelve a extraerlos e inténtalo de nuevo.";
}

export type TransformerClient = {
  getCapabilities(): Promise<Record<TransformerResource, boolean>>;
  createLoad(input: TransformerLoadInput): Promise<{ loadId: string; reused: boolean }>;
  getLoad(loadId: string): Promise<TransformerState>;
  createComparison(input: TransformerComparisonInput, file: { name: string; bytes: Uint8Array }): Promise<{ reportId: string }>;
  createReport(input: TransformerReportInput): Promise<{ reportId: string; reused: boolean }>;
  getReport(reportId: string): Promise<TransformerState>;
  downloadReport(reportId: string): Promise<Response>;
};

export function createTransformerClient(options: { fetcher?: typeof fetch; transformer?: TransformerKey } = {}): TransformerClient {
  const fetcher = options.fetcher ?? fetch;
  const definition = transformerDefinitions[options.transformer ?? "bmw"];
  let capabilities: { at: number; value: Record<TransformerResource, boolean> } | undefined;

  function baseUrl() {
    const raw = process.env[definition.envVar]?.trim();
    const fail = () => new ReaderError("La integración con el transformer no está configurada correctamente.", "TRANSFORMER_CONFIGURATION_ERROR", false, 500);
    if (!raw) throw fail();
    let url: URL;
    try { url = new URL(raw); } catch { throw fail(); }
    if (!isTrustedServiceUrl(url) || url.username || url.password || url.search || url.hash) throw fail();
    return url;
  }

  async function call(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const url = new URL(path, baseUrl());
    try {
      return await fetcher(url, { ...init, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ReaderError("El servicio de carga de datos no está disponible.", "TRANSFORMER_UNAVAILABLE", true);
    }
  }

  async function json(path: string, init?: RequestInit, timeoutMs?: number) {
    const response = await call(path, { ...init, headers: { Accept: "application/json", ...init?.headers } }, timeoutMs);
    if (response.status >= 300 && response.status < 400) throw new ReaderError("El transformer ha devuelto una redirección no permitida.", "INVALID_TRANSFORMER_REDIRECT", false);
    if (!response.ok) {
      const { code, message, details } = await upstreamError(response);
      if (response.status === 404) throw new ReaderError("El trabajo del transformer ya no está disponible.", "TRANSFORMER_JOB_NOT_FOUND", false, 404);
      if (response.status === 409) throw new ReaderError(message ?? "La carga todavía no está completada.", "TRANSFORMER_CONFLICT", false, 409);
      if (response.status === 413) throw new ReaderError("El fichero supera el tamaño permitido.", "TRANSFORMER_PAYLOAD_TOO_LARGE", false, 413);
      if (response.status === 422 && code === "NOT_AVAILABLE") throw new ReaderError(notAvailableMessage(details), "TRANSFORMER_NOT_AVAILABLE", false, 422);
      if (response.status === 501) throw new ReaderError("Este transformer no admite la operación solicitada.", "TRANSFORMER_NOT_SUPPORTED", false, 501);
      throw new ReaderError(response.status >= 500 ? "El servicio de carga de datos no está disponible temporalmente." : (message ?? "El transformer no ha aceptado la solicitud."), "TRANSFORMER_REQUEST_FAILED", response.status >= 500);
    }
    try { return await readJsonBounded(response, MAX_RESPONSE_BYTES); }
    catch { throw new ReaderError("El transformer ha devuelto una respuesta no válida.", "INVALID_TRANSFORMER_RESPONSE", false); }
  }

  const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw new ReaderError("El transformer ha devuelto una respuesta no válida.", "INVALID_TRANSFORMER_RESPONSE", false);
    return result.data;
  };

  async function getCapabilities() {
    if (capabilities && Date.now() - capabilities.at < CAPABILITIES_TTL_MS) return capabilities.value;
    const value: Record<TransformerResource, boolean> = { loads: definition.resources.includes("loads"), reports: definition.resources.includes("reports") };
    try {
      const info = parse(transformerInfoSchema, await json("/v1/info"));
      for (const resource of ["loads", "reports"] as const) value[resource] = info.capabilities[resource]?.create ?? false;
    } catch (error) {
      if (error instanceof ReaderError && error.code === "TRANSFORMER_CONFIGURATION_ERROR") throw error;
      // An unreachable or older service is not decided here: the create call reports the real problem.
    }
    capabilities = { at: Date.now(), value };
    return value;
  }

  async function requireResource(resource: TransformerResource) {
    if (!(await getCapabilities())[resource]) throw new ReaderError("Este transformer no admite la operación solicitada.", "TRANSFORMER_NOT_SUPPORTED", false, 501);
  }

  const jsonPost = (path: string, body: unknown) => json(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  return {
    getCapabilities,
    async createLoad(input) {
      await requireResource("loads");
      const body = createBody(definition, { axCode: input.axCode, imcEdition: input.imcEdition, selection: bmwLoadSelection(input) });
      const result = parse(transformerEnqueuedSchema, await jsonPost("/v1/loads", body));
      return { loadId: result.requestId, reused: result.reused ?? false };
    },
    async getLoad(loadId) {
      return parse(transformerStateSchema, await json(`/v1/loads/${encodeURIComponent(loadId)}`));
    },
    async createComparison({ loadId, axCode, imcEdition }, file) {
      if (file.bytes.byteLength > MAX_LST_BYTES) throw new ReaderError("El fichero supera el tamaño permitido.", "TRANSFORMER_PAYLOAD_TOO_LARGE", false, 413);
      await requireResource("reports");
      const form = new FormData();
      form.set("file", new File([file.bytes as BlobPart], file.name, { type: "application/octet-stream" }));
      form.set("metadata", JSON.stringify(createBody(definition, { axCode, imcEdition, selection: { loadId } })));
      const result = parse(transformerEnqueuedSchema, await json("/v1/reports", { method: "POST", body: form }, UPLOAD_TIMEOUT_MS));
      return { reportId: result.requestId };
    },
    async createReport(input) {
      await requireResource("reports");
      const result = parse(transformerEnqueuedSchema, await jsonPost("/v1/reports", createBody(definition, input)));
      return { reportId: result.requestId, reused: result.reused ?? false };
    },
    async getReport(reportId) {
      return parse(transformerStateSchema, await json(`/v1/reports/${encodeURIComponent(reportId)}`));
    },
    async downloadReport(reportId) {
      const redirect = await call(`/v1/reports/${encodeURIComponent(reportId)}/download`, {}, DOWNLOAD_TIMEOUT_MS);
      if (redirect.status === 409) throw new ReaderError("El Excel todavía no está listo.", "TRANSFORMER_CONFLICT", false, 409);
      if (redirect.status === 404) throw new ReaderError("El trabajo del transformer ya no está disponible.", "TRANSFORMER_JOB_NOT_FOUND", false, 404);
      const location = redirect.headers.get("location");
      if (redirect.status !== 307 || !location) throw new ReaderError("No se ha podido preparar la descarga del Excel.", "TRANSFORMER_REQUEST_FAILED", false);
      let target: URL;
      try { target = new URL(location); } catch { throw new ReaderError("No se ha podido preparar la descarga del Excel.", "TRANSFORMER_REQUEST_FAILED", false); }
      if (target.protocol !== "https:" && target.protocol !== "http:") throw new ReaderError("No se ha podido preparar la descarga del Excel.", "TRANSFORMER_REQUEST_FAILED", false);
      let file: Response;
      try { file = await fetcher(target, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }); }
      catch { throw new ReaderError("No se ha podido descargar el Excel.", "TRANSFORMER_UNAVAILABLE", true); }
      if (!file.ok || !file.body) throw new ReaderError("No se ha podido descargar el Excel.", "TRANSFORMER_REQUEST_FAILED", false);
      return file;
    },
  };
}

const defaultClients = new Map<TransformerKey, TransformerClient>();
export function getTransformerClient(key: TransformerKey = "bmw") {
  let client = defaultClients.get(key);
  if (!client) defaultClients.set(key, client = createTransformerClient({ transformer: key }));
  return client;
}
