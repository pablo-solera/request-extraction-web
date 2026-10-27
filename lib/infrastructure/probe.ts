import "server-only";

import { z } from "zod";
import { infrastructureManufacturers, type InfrastructureService } from "@/lib/infrastructure/services";

const PROBE_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const checkNameSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const readyResponseSchema = z.object({
  status: z.enum(["ready", "unavailable"]),
  checks: z.record(checkNameSchema, z.enum(["ok", "error"])).optional(),
}).strip();

export type InfrastructureStatus = "ready" | "not-ready" | "running" | "down" | "unexpected" | "unconfigured";
export type InfrastructureProbe = {
  key: string;
  name: string;
  kind: "reader" | "transformer";
  status: InfrastructureStatus;
  checks: Record<string, "ok" | "error"> | null;
  httpStatus: number | null;
  latencyMs: number | null;
  checkedAt: string;
  origin: string | null;
};

function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid-url");
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(isLoopback && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("invalid-url");
  }

  return url;
}

function readOrigin(url: URL) {
  return url.host;
}

async function readSmallJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
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
      if (byteLength > MAX_RESPONSE_BYTES) {
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

async function get(url: URL) {
  return fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
}

async function probeOne(service: InfrastructureService): Promise<InfrastructureProbe> {
  const checkedAt = new Date().toISOString();
  const rawBaseUrl = process.env[service.envVar]?.trim();
  if (!rawBaseUrl) {
    return { ...service, status: "unconfigured", checks: null, httpStatus: null, latencyMs: null, checkedAt, origin: null };
  }

  const startedAt = performance.now();
  let baseUrl: URL;
  try {
    baseUrl = parseBaseUrl(rawBaseUrl);
  } catch {
    return { ...service, status: "unexpected", checks: null, httpStatus: null, latencyMs: 0, checkedAt, origin: null };
  }

  const result = (status: InfrastructureStatus, httpStatus: number | null, checks: Record<string, "ok" | "error"> | null = null): InfrastructureProbe => ({
    ...service,
    status,
    checks,
    httpStatus,
    latencyMs: Math.round(performance.now() - startedAt),
    checkedAt,
    origin: readOrigin(baseUrl),
  });

  try {
    const readyUrl = new URL("/ready", baseUrl);
    const readyResponse = await get(readyUrl);

    if (readyResponse.status === 404) {
      const healthResponse = await get(new URL("/health", baseUrl));
      if (healthResponse.ok) return result("running", healthResponse.status);
      return result("unexpected", healthResponse.status);
    }

    if (readyResponse.status !== 200 && readyResponse.status !== 503) return result("unexpected", readyResponse.status);

    let body: unknown;
    try {
      body = await readSmallJson(readyResponse);
    } catch {
      return result("unexpected", readyResponse.status);
    }
    const parsed = readyResponseSchema.safeParse(body);
    if (!parsed.success || (readyResponse.status === 200 && parsed.data.status !== "ready") || (readyResponse.status === 503 && parsed.data.status !== "unavailable")) {
      return result("unexpected", readyResponse.status);
    }

    return result(parsed.data.status === "ready" ? "ready" : "not-ready", readyResponse.status, parsed.data.checks ?? null);
  } catch {
    return result("down", null);
  }
}

export type ManufacturerInfrastructure = {
  key: string;
  name: string;
  reader: InfrastructureProbe;
  transformer: InfrastructureProbe;
};

export async function getInfrastructureStatus(): Promise<ManufacturerInfrastructure[]> {
  return Promise.all(infrastructureManufacturers.map(async ({ key, name, reader, transformer }) => {
    const [readerProbe, transformerProbe] = await Promise.all([probeOne(reader), probeOne(transformer)]);
    return { key, name, reader: readerProbe, transformer: transformerProbe };
  }));
}
