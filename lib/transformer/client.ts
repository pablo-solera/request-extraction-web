import "server-only";

import { ReaderError } from "@/lib/readers/errors";
import { transformerEnqueuedSchema, transformerStateSchema, type TransformerLoadInput, type TransformerState } from "@/lib/transformer/types";

const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
export const MAX_LST_BYTES = 25 * 1024 * 1024;

function requiredBaseUrl() {
  const raw = process.env.BMW_TRANSFORMER_BASE_URL?.trim();
  const fail = () => new ReaderError("La integración con el transformer no está configurada correctamente.", "TRANSFORMER_CONFIGURATION_ERROR", false, 500);
  if (!raw) throw fail();
  let url: URL;
  try { url = new URL(raw); } catch { throw fail(); }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) throw fail();
  return url;
}

async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > maxBytes) throw new Error("response-too-large");
  return JSON.parse(text) as unknown;
}

async function upstreamMessage(response: Response) {
  try {
    const body = await readJsonBounded(response, 16 * 1024);
    if (body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string") return (body as { error: string }).error;
  } catch { /* details are intentionally discarded */ }
  return null;
}

export type TransformerClient = {
  createLoad(input: TransformerLoadInput): Promise<{ loadId: string; reused: boolean }>;
  getLoad(loadId: string): Promise<TransformerState>;
  createComparison(loadId: string, file: { name: string; bytes: Uint8Array }): Promise<{ reportId: string }>;
  getReport(reportId: string): Promise<TransformerState>;
  downloadReport(reportId: string): Promise<Response>;
};

export function createTransformerClient(options: { fetcher?: typeof fetch } = {}): TransformerClient {
  const fetcher = options.fetcher ?? fetch;

  async function call(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const url = new URL(path, requiredBaseUrl());
    let response: Response;
    try {
      response = await fetcher(url, { ...init, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ReaderError("El servicio de carga de datos no está disponible.", "TRANSFORMER_UNAVAILABLE", true);
    }
    return response;
  }

  async function json(path: string, init?: RequestInit) {
    const response = await call(path, { ...init, headers: { Accept: "application/json", ...init?.headers } });
    if (response.status >= 300 && response.status < 400) throw new ReaderError("El transformer ha devuelto una redirección no permitida.", "INVALID_TRANSFORMER_REDIRECT", false);
    if (!response.ok) {
      const message = await upstreamMessage(response);
      if (response.status === 404) throw new ReaderError("El trabajo del transformer ya no está disponible.", "TRANSFORMER_JOB_NOT_FOUND", false, 404);
      if (response.status === 409) throw new ReaderError(message ?? "La carga todavía no está completada.", "TRANSFORMER_CONFLICT", false, 409);
      if (response.status === 413) throw new ReaderError("El fichero supera el tamaño permitido.", "TRANSFORMER_PAYLOAD_TOO_LARGE", false, 413);
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

  return {
    async createLoad(input) {
      const body = {
        axCode: input.axCode,
        edition: input.imcEdition,
        manufacturer: input.brand,
        brand: input.brand,
        typekeys: input.typekeys.map(({ typekey, series, family }) => ({ typekey, series, family })),
      };
      const result = parse(transformerEnqueuedSchema, await json("/loads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      return { loadId: result.requestId, reused: result.reused ?? false };
    },
    async getLoad(loadId) {
      return parse(transformerStateSchema, await json(`/loads/${encodeURIComponent(loadId)}`));
    },
    async createComparison(loadId, file) {
      if (file.bytes.byteLength > MAX_LST_BYTES) throw new ReaderError("El fichero supera el tamaño permitido.", "TRANSFORMER_PAYLOAD_TOO_LARGE", false, 413);
      const form = new FormData();
      form.set("file", new File([file.bytes as BlobPart], file.name, { type: "application/octet-stream" }));
      form.set("metadata", JSON.stringify({ loadId }));
      const result = parse(transformerEnqueuedSchema, await json("/reports", { method: "POST", body: form }));
      return { reportId: result.requestId };
    },
    async getReport(reportId) {
      return parse(transformerStateSchema, await json(`/reports/${encodeURIComponent(reportId)}`));
    },
    async downloadReport(reportId) {
      const redirect = await call(`/reports/${encodeURIComponent(reportId)}/download`, {}, DOWNLOAD_TIMEOUT_MS);
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

let defaultClient: TransformerClient | undefined;
export function getTransformerClient() {
  return (defaultClient ??= createTransformerClient());
}

