import "server-only";

import { z } from "zod";
import { ReaderError } from "@/lib/readers/errors";
import { isTrustedServiceUrl } from "@/lib/readers/service-url";
import {
  MERCEDES_MANUFACTURER, mercedesCreateResponseSchema, mercedesLabourActionResponseSchema, mercedesLabourStateSchema, parseMercedesModelOptions, parseMercedesSeriesOptions,
  type MercedesLabourState, type MercedesModelOptions, type MercedesOption,
} from "@/lib/readers/mercedes/types";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_OPTIONS_RESPONSE_BYTES = 2 * 1024 * 1024;
const OPTIONS_CACHE_TTL_MS = 60 * 60 * 1000;

function requiredBaseUrl() {
  const fail = () => new ReaderError("La integración con Mercedes-Benz no está configurada correctamente.", "READER_CONFIGURATION_ERROR", false, 500);
  const raw = process.env.MERCEDES_READER_BASE_URL?.trim();
  if (!raw) throw fail();
  let url: URL;
  try { url = new URL(raw); } catch { throw fail(); }
  if (!isTrustedServiceUrl(url) || url.username || url.password || url.search || url.hash) throw fail();
  return url;
}

async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxBytes) throw new Error("response-too-large");
  return JSON.parse(text) as unknown;
}

async function upstreamError(response: Response): Promise<{ code: string | null; message: string | null }> {
  try {
    const body = await readJsonBounded(response, 16 * 1024);
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    if (typeof error === "string") return { code: null, message: error };
    if (error && typeof error === "object") {
      const { code, message } = error as { code?: unknown; message?: unknown };
      return { code: typeof code === "string" ? code : null, message: typeof message === "string" ? message : null };
    }
  } catch { /* details are intentionally discarded; callers receive stable Spanish messages */ }
  return { code: null, message: null };
}

const createSchema = z.object({
  series: z.string().trim().min(1).max(100),
  modelDesignations: z.array(z.string().trim().min(1).max(50)).min(1).max(100),
  axCode: z.string().regex(/^[A-Za-z0-9]{3,4}$/).transform((value) => value.toUpperCase()),
  imcEdition: z.string().regex(/^\d{2}\/\d$/),
  date: z.string().regex(/^\d{8}$/),
});

export type MercedesLabourParams = z.input<typeof createSchema>;

export type MercedesReaderClient = {
  getSeries(): Promise<MercedesOption[]>;
  getModels(series: string, productGroup?: string): Promise<MercedesModelOptions>;
  createLabour(params: MercedesLabourParams): Promise<{ requestId: string; status?: string }>;
  getLabourState(requestId: string): Promise<MercedesLabourState>;
  cancelLabour(requestId: string): Promise<{ requestId: string; status: "cancelled" | "cancelling" }>;
  resumeLabour(requestId: string, force?: boolean): Promise<{ requestId: string; status: string }>;
};

export function createMercedesReaderClient(options: { fetcher?: typeof fetch; now?: () => number } = {}): MercedesReaderClient {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; value: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();

  async function read(path: string, init?: RequestInit, maxBytes = 64 * 1024) {
    const url = new URL(path, requiredBaseUrl());
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
      throw new ReaderError("El servicio de Mercedes-Benz no está disponible.", "READER_UNAVAILABLE", true);
    }
    if (response.status >= 300 && response.status < 400) throw new ReaderError("El reader ha devuelto una redirección no permitida.", "INVALID_READER_REDIRECT", false);
    if (!response.ok) {
      const { code, message } = await upstreamError(response);
      if (response.status === 422 && code === "NOT_AVAILABLE") throw new ReaderError(message ?? "Mercedes-Benz no tiene datos disponibles para el modelo solicitado.", "MODEL_NOT_AVAILABLE", false, 422);
      if (response.status === 409) throw new ReaderError(message ?? "La petición no admite esta acción en su estado actual.", "READER_CONFLICT", false, 409);
      if (response.status === 501) throw new ReaderError("Este reader no admite la operación solicitada.", "READER_NOT_SUPPORTED", false, 501);
      if (response.status === 404 && path.startsWith("/v1/models/options")) throw new ReaderError("Mercedes-Benz Reader no ofrece la consulta de modelos configurada.", "MODEL_OPTIONS_UNAVAILABLE", false, 502);
      if (response.status === 404) throw new ReaderError("El trabajo de Mercedes-Benz ya no está disponible.", "JOB_NOT_FOUND", false, 404);
      throw new ReaderError(response.status >= 500 ? "El servicio de Mercedes-Benz no está disponible temporalmente." : "Mercedes-Benz no ha aceptado la solicitud.", "READER_REQUEST_FAILED", response.status >= 500);
    }
    try { return await readJsonBounded(response, maxBytes); }
    catch { throw new ReaderError("Mercedes-Benz ha devuelto una respuesta no válida.", "INVALID_READER_RESPONSE", false); }
  }

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value as T;
    const active = inflight.get(key);
    if (active) return active as Promise<T>;
    const pending = load();
    inflight.set(key, pending);
    try {
      const value = await pending;
      cache.set(key, { expiresAt: now() + OPTIONS_CACHE_TTL_MS, value });
      return value;
    } finally {
      if (inflight.get(key) === pending) inflight.delete(key);
    }
  }

  const invalid = (what: string) => new ReaderError(`No se han podido cargar ${what} de Mercedes-Benz.`, "INVALID_READER_RESPONSE", false);

  return {
    getSeries() {
      const query = new URLSearchParams({ manufacturer: MERCEDES_MANUFACTURER });
      return cached(`series:${query}`, async () => {
        const raw = await read(`/v1/models/options?${query}`, undefined, MAX_OPTIONS_RESPONSE_BYTES);
        try { return parseMercedesSeriesOptions(raw); } catch { throw invalid("las series"); }
      });
    },
    getModels(rawSeries, rawProductGroup) {
      const series = z.string().trim().min(1).max(100).parse(rawSeries);
      const productGroup = rawProductGroup === undefined ? undefined : z.string().trim().min(1).max(100).parse(rawProductGroup);
      const query = new URLSearchParams({ manufacturer: MERCEDES_MANUFACTURER, series, ...(productGroup ? { productGroup } : {}) });
      return cached(`models:${query}`, async () => {
        const raw = await read(`/v1/models/options?${query}`, undefined, MAX_OPTIONS_RESPONSE_BYTES);
        try { return parseMercedesModelOptions(raw); } catch { throw invalid("los modelos"); }
      });
    },
    async createLabour(params) {
      const parsed = createSchema.parse(params);
      const raw = await read("/v1/labours", {
        method: "POST",
        body: JSON.stringify({
          manufacturer: MERCEDES_MANUFACTURER,
          axCode: parsed.axCode,
          edition: parsed.imcEdition.replace("/", "_"),
          selection: { date: parsed.date, series: parsed.series, models: parsed.modelDesignations.map((modelDesignation) => ({ modelDesignation })) },
        }),
      });
      try { return mercedesCreateResponseSchema.parse(raw); }
      catch { throw new ReaderError("Mercedes-Benz ha devuelto una respuesta de creación no válida.", "INVALID_READER_RESPONSE", false); }
    },
    async getLabourState(requestId) {
      const raw = await read(`/v1/labours/${encodeURIComponent(z.uuid().parse(requestId))}`);
      try { return mercedesLabourStateSchema.parse(raw); }
      catch { throw new ReaderError("Mercedes-Benz ha devuelto un estado no válido.", "INVALID_READER_RESPONSE", false); }
    },
    async cancelLabour(requestId) {
      const raw = await read(`/v1/labours/${encodeURIComponent(z.uuid().parse(requestId))}/cancel`, { method: "POST", body: "{}" });
      try {
        const parsed = mercedesLabourActionResponseSchema.parse(raw);
        if (parsed.status !== "cancelled" && parsed.status !== "cancelling") throw new Error("unsupported status");
        return { requestId: parsed.requestId, status: parsed.status };
      } catch { throw new ReaderError("Mercedes-Benz ha devuelto una respuesta de cancelación no válida.", "INVALID_READER_RESPONSE", false); }
    },
    async resumeLabour(requestId, force = false) {
      const raw = await read(`/v1/labours/${encodeURIComponent(z.uuid().parse(requestId))}/resume`, { method: "POST", body: JSON.stringify({ force }) });
      try { return { ...z.object({ requestId: z.uuid() }).passthrough().parse(raw), status: "queued" }; }
      catch { throw new ReaderError("Mercedes-Benz ha devuelto una respuesta de reanudación no válida.", "INVALID_READER_RESPONSE", false); }
    },
  };
}

const client = createMercedesReaderClient();

export const getMercedesSeries = () => client.getSeries();
export const getMercedesModels = (series: string, productGroup?: string) => client.getModels(series, productGroup);
export const createMercedesLabour = (params: MercedesLabourParams) => client.createLabour(params);
export const getMercedesLabourState = (requestId: string) => client.getLabourState(requestId);
export const cancelMercedesLabour = (requestId: string) => client.cancelLabour(requestId);
export const resumeMercedesLabour = (requestId: string, force = false) => client.resumeLabour(requestId, force);
