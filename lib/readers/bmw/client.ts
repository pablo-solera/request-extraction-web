import "server-only";

import { z } from "zod";
import { ReaderError } from "@/lib/readers/errors";
import { bmwBrandSchema, bmwCreateResponseSchema, bmwLabourActionResponseSchema, bmwLabourStateSchema, parseBmwDevelopmentCodes, parseBmwSeriesOptions, parseBmwTypekeys, type BmwBrand, type BmwDevelopmentCodeOption, type BmwLabourState, type BmwSeriesOption, type BmwTypekeyOption } from "@/lib/readers/bmw/types";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_OPTIONS_RESPONSE_BYTES = 512 * 1024;
const SERIES_CACHE_TTL_MS = 60 * 60 * 1000;

function requiredBaseUrl() {
  const raw = process.env.BMW_READER_BASE_URL?.trim();
  if (!raw) throw new ReaderError("La integración con BMW no está configurada correctamente.", "READER_CONFIGURATION_ERROR", false, 500);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ReaderError("La integración con BMW no está configurada correctamente.", "READER_CONFIGURATION_ERROR", false, 500);
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new ReaderError("La conexión con BMW debe usar HTTPS fuera del equipo local.", "READER_CONFIGURATION_ERROR", false, 500);
  }

  return url;
}

function endpoint(path: string) {
  return new URL(path, requiredBaseUrl());
}

async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error("response-too-large");
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new Error("response-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function upstreamMessage(response: Response) {
  try {
    const body = await readJsonBounded(response, 16 * 1024);
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === "string") return error;
      if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
    }
  } catch {
    // Error details are intentionally discarded; callers receive stable Spanish messages.
  }
  return null;
}

export type BmwLabourParams = {
  brand: BmwBrand;
  series: string;
  developmentCode: string;
  typekey: string;
  axCode: string;
  imcEdition: string;
  language?: string;
};

export type BmwReaderClient = {
  getSeries(brand: BmwBrand): Promise<BmwSeriesOption[]>;
  getDevelopmentCodes(brand: BmwBrand, series: string): Promise<BmwDevelopmentCodeOption[]>;
  getTypekeys(brand: BmwBrand, series: string, developmentCode: string): Promise<BmwTypekeyOption[]>;
  createLabour(params: BmwLabourParams): Promise<{ requestId: string; status?: string }>;
  getLabourState(requestId: string): Promise<BmwLabourState>;
  cancelLabour(requestId: string): Promise<{ requestId: string; status: "cancelled" | "cancelling" }>;
  resumeLabour(requestId: string, force?: boolean): Promise<{ requestId: string; status: string }>;
  downloadLabourArchive(requestId: string): Promise<Response>;
};

export function createBmwReaderClient(options: { fetcher?: typeof fetch; now?: () => number } = {}): BmwReaderClient {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<BmwBrand, { expiresAt: number; values: BmwSeriesOption[] }>();
  const inflight = new Map<BmwBrand, Promise<BmwSeriesOption[]>>();
  const filteredCache = new Map<string, { expiresAt: number; values: unknown[] }>();
  const filteredInflight = new Map<string, Promise<unknown[]>>();

  async function cachedOptions<T extends { value: string; label: string }>(key: string, load: () => Promise<T[]>): Promise<T[]> {
    const cached = filteredCache.get(key);
    if (cached && cached.expiresAt > now()) return cached.values as T[];
    const active = filteredInflight.get(key);
    if (active) return active as Promise<T[]>;
    const pending = load();
    filteredInflight.set(key, pending);
    try {
      const values = await pending;
      filteredCache.set(key, { expiresAt: now() + SERIES_CACHE_TTL_MS, values });
      return values;
    } finally {
      if (filteredInflight.get(key) === pending) filteredInflight.delete(key);
    }
  }

  function optionsQuery(brand: BmwBrand, series: string, developmentCode?: string) {
    return new URLSearchParams({
      brand,
      modelSeries: series,
      ...(developmentCode ? { developmentCode } : {}),
      language: process.env.BMW_READER_LANGUAGE?.trim() || "en-GB",
    });
  }

  async function read(path: string, init?: RequestInit, maxBytes = MAX_OPTIONS_RESPONSE_BYTES) {
    const url = endpoint(path);
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        cache: "no-store",
        redirect: "manual",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ReaderError("El servicio de BMW no está disponible.", "READER_UNAVAILABLE", true);
    }
    if (response.status >= 300 && response.status < 400) throw new ReaderError("El reader ha devuelto una redirección no permitida.", "INVALID_READER_REDIRECT", false);
    if (!response.ok) {
      const message = await upstreamMessage(response);
      if (response.status === 409) throw new ReaderError(message ?? "La petición no admite esta acción en su estado actual.", "READER_CONFLICT", false, 409);
      if (response.status === 404 && path.startsWith("/v1/models/options")) throw new ReaderError("BMW Reader no ofrece la consulta de series configurada.", "MODEL_OPTIONS_UNAVAILABLE", false, 502);
      if (response.status === 404) throw new ReaderError("El trabajo de BMW ya no está disponible.", "JOB_NOT_FOUND", false, 404);
      throw new ReaderError(response.status >= 500 ? "El servicio de BMW no está disponible temporalmente." : "BMW no ha aceptado la solicitud.", "READER_REQUEST_FAILED", response.status >= 500);
    }
    try {
      return await readJsonBounded(response, maxBytes);
    } catch {
      throw new ReaderError("BMW ha devuelto una respuesta no válida.", "INVALID_READER_RESPONSE", false);
    }
  }

  async function getSeries(rawBrand: BmwBrand) {
    const brand = bmwBrandSchema.parse(rawBrand);
    const cached = cache.get(brand);
    if (cached && cached.expiresAt > now()) return cached.values;

    const active = inflight.get(brand);
    if (active) return active;
    const query = new URLSearchParams({ brand, language: process.env.BMW_READER_LANGUAGE?.trim() || "en-GB" });
    const pending = (async () => {
      const raw = await read(`/v1/models/options?${query.toString()}`);
      let values: BmwSeriesOption[];
      try {
        values = parseBmwSeriesOptions(raw);
      } catch {
        throw new ReaderError("No se han podido cargar las series BMW.", "INVALID_READER_RESPONSE", false);
      }
      cache.set(brand, { expiresAt: now() + SERIES_CACHE_TTL_MS, values });
      return values;
    })();
    inflight.set(brand, pending);
    try {
      return await pending;
    } finally {
      if (inflight.get(brand) === pending) inflight.delete(brand);
    }
  }

  async function getDevelopmentCodes(rawBrand: BmwBrand, rawSeries: string) {
    const brand = bmwBrandSchema.parse(rawBrand);
    const series = z.string().trim().min(1).max(100).parse(rawSeries);
    const query = optionsQuery(brand, series);
    const key = `developmentCode:${query.toString()}`;
    return cachedOptions(key, async () => {
      const raw = await read(`/v1/models/options?${query.toString()}`);
      try { return parseBmwDevelopmentCodes(raw); }
      catch { throw new ReaderError("No se han podido cargar los códigos de desarrollo BMW.", "INVALID_READER_RESPONSE", false); }
    });
  }

  async function getTypekeys(rawBrand: BmwBrand, rawSeries: string, rawDevelopmentCode: string) {
    const brand = bmwBrandSchema.parse(rawBrand);
    const series = z.string().trim().min(1).max(100).parse(rawSeries);
    const developmentCode = z.string().regex(/^[A-Z0-9]+$/).parse(rawDevelopmentCode);
    const query = optionsQuery(brand, series, developmentCode);
    const key = `typekeys:${query.toString()}`;
    return cachedOptions(key, async () => {
      const raw = await read(`/v1/models/options?${query.toString()}`);
      try { return parseBmwTypekeys(raw); }
      catch { throw new ReaderError("No se han podido cargar los typekeys BMW.", "INVALID_READER_RESPONSE", false); }
    });
  }

  return {
    getSeries,
    getDevelopmentCodes,
    getTypekeys,
    async createLabour(params) {
      const parsed = z.object({
        brand: bmwBrandSchema,
        series: z.string().trim().min(1).max(100),
        developmentCode: z.string().regex(/^[A-Z0-9]+$/),
        typekey: z.string().regex(/^[A-Z0-9]{4}$/),
        axCode: z.string().regex(/^[A-Za-z0-9_]{1,100}$/),
        imcEdition: z.string().regex(/^\d{2}\/\d$/),
        language: z.string().trim().min(2).max(20).optional(),
      }).parse(params);
      const edition = parsed.imcEdition.replace("/", "_");
      const raw = await read("/v1/labours", {
        method: "POST",
        body: JSON.stringify({
          manufacturer: parsed.brand,
          axCode: parsed.axCode,
          edition,
          language: parsed.language || process.env.BMW_READER_LANGUAGE?.trim() || "en-GB",
          selection: {
            series: parsed.series,
            typekeys: [{ typekey: parsed.typekey, series: parsed.series, family: parsed.developmentCode }],
          },
        }),
      }, 64 * 1024);
      try {
        return bmwCreateResponseSchema.parse(raw);
      } catch {
        throw new ReaderError("BMW ha devuelto una respuesta de creación no válida.", "INVALID_READER_RESPONSE", false);
      }
    },
    async getLabourState(requestId) {
      const id = z.uuid().parse(requestId);
      const raw = await read(`/v1/labours/${encodeURIComponent(id)}`, undefined, 64 * 1024);
      try {
        return bmwLabourStateSchema.parse(raw);
      } catch {
        throw new ReaderError("BMW ha devuelto un estado no válido.", "INVALID_READER_RESPONSE", false);
      }
    },
    async cancelLabour(requestId) {
      const id = z.uuid().parse(requestId);
      const raw = await read(`/v1/labours/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }, 64 * 1024);
      try {
        const parsed = bmwLabourActionResponseSchema.parse(raw);
        if (parsed.status !== "cancelled" && parsed.status !== "cancelling") throw new Error("unsupported status");
        return { requestId: parsed.requestId, status: parsed.status };
      } catch {
        throw new ReaderError("BMW ha devuelto una respuesta de cancelación no válida.", "INVALID_READER_RESPONSE", false);
      }
    },
    async resumeLabour(requestId, force = false) {
      const id = z.uuid().parse(requestId);
      const raw = await read(`/v1/labours/${encodeURIComponent(id)}/resume`, { method: "POST", body: JSON.stringify({ force }) }, 64 * 1024);
      try {
        const response = z.object({ requestId: z.uuid() }).passthrough().parse(raw);
        return { ...response, status: "queued" };
      }
      catch { throw new ReaderError("BMW ha devuelto una respuesta de reanudación no válida.", "INVALID_READER_RESPONSE", false); }
    },
    async downloadLabourArchive(requestId) {
      const id = z.uuid().parse(requestId);
      let response: Response;
      try {
        response = await fetcher(endpoint(`/v1/labours/${encodeURIComponent(id)}/archive.zip`), {
          cache: "no-store",
          redirect: "manual",
          headers: { Accept: "application/zip" },
          signal: AbortSignal.timeout(15 * 60_000),
        });
      } catch {
        throw new ReaderError("No se ha podido preparar el ZIP BMW.", "READER_UNAVAILABLE", true);
      }
      if (response.status === 409) {
        await response.body?.cancel();
        throw new ReaderError("El ZIP estará disponible cuando la extracción haya terminado.", "JOB_NOT_READY", true, 409);
      }
      if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/zip") {
        await response.body?.cancel();
        throw new ReaderError("BMW no ha podido generar el ZIP de la extracción.", "DOWNLOAD_UNAVAILABLE", response.status >= 500, response.status >= 400 ? response.status : 502);
      }
      return response;
    },
  };
}

const bmwReaderClient = createBmwReaderClient();

export function getBmwModelSeries(brand: BmwBrand) {
  return bmwReaderClient.getSeries(brand);
}

export function getBmwDevelopmentCodes(brand: BmwBrand, series: string) {
  return bmwReaderClient.getDevelopmentCodes(brand, series);
}

export function getBmwTypekeys(brand: BmwBrand, series: string, developmentCode: string) {
  return bmwReaderClient.getTypekeys(brand, series, developmentCode);
}

export function createBmwLabour(params: BmwLabourParams) {
  return bmwReaderClient.createLabour(params);
}

export function getBmwLabourState(requestId: string) {
  return bmwReaderClient.getLabourState(requestId);
}

export function cancelBmwLabour(requestId: string) {
  return bmwReaderClient.cancelLabour(requestId);
}

export function resumeBmwLabour(requestId: string, force = false) {
  return bmwReaderClient.resumeLabour(requestId, force);
}

export function downloadBmwLabourArchive(requestId: string) {
  return bmwReaderClient.downloadLabourArchive(requestId);
}
