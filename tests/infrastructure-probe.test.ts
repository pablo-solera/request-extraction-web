import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInfrastructureStatus } from "@/lib/infrastructure/probe";

const variables = ["BMW", "RENAULT", "VAG"].flatMap((prefix) => [`${prefix}_READER_BASE_URL`, `${prefix}_TRANSFORMER_BASE_URL`]);
const original = Object.fromEntries(variables.map((name) => [name, process.env[name]]));

function bmw(result: Awaited<ReturnType<typeof getInfrastructureStatus>>) {
  return result.find((manufacturer) => manufacturer.key === "bmw")!;
}

beforeEach(() => {
  for (const name of variables) delete process.env[name];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of variables) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe("infrastructure probe", () => {
  it("groups the reader and the transformer of every manufacturer", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await getInfrastructureStatus();

    expect(result.map((manufacturer) => manufacturer.key)).toEqual(["bmw", "renault", "vag"]);
    expect(bmw(result).reader).toMatchObject({ key: "bmw-reader", kind: "reader" });
    expect(bmw(result).transformer).toMatchObject({ key: "bmw-transformer", kind: "transformer" });
    expect(result.every((manufacturer) => manufacturer.reader.status === "unconfigured" && manufacturer.transformer.status === "unconfigured")).toBe(true);
  });

  it("reports ready status and sanitized dependency checks for the reader and the transformer", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    process.env.BMW_TRANSFORMER_BASE_URL = "http://127.0.0.1:3005";
    const fetchMock = vi.fn(async (url: URL) => url.port === "3004"
      ? Response.json({ status: "ready", checks: { redis: "ok", s3: "ok" }, internal: "ignored" })
      : Response.json({ status: "ready", checks: { redis: "ok", s3: "ok", sqlserver: "ok" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { reader, transformer } = bmw(await getInfrastructureStatus());

    expect(reader).toMatchObject({ status: "ready", checks: { redis: "ok", s3: "ok" }, httpStatus: 200, origin: "127.0.0.1:3004" });
    expect(transformer).toMatchObject({ status: "ready", checks: { redis: "ok", s3: "ok", sqlserver: "ok" }, origin: "127.0.0.1:3005" });
    expect(fetchMock).toHaveBeenCalledWith(new URL("http://127.0.0.1:3005/ready"), expect.objectContaining({ cache: "no-store", redirect: "manual" }));
  });

  it("keeps the reader ready when only the transformer is failing", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.port === "3004"
      ? Response.json({ status: "ready" })
      : Response.json({ status: "unavailable", checks: { redis: "ok", sqlserver: "error" } }, { status: 503 })));

    const { reader, transformer } = bmw(await getInfrastructureStatus());

    expect(reader.status).toBe("ready");
    expect(transformer.status).toBe("not-ready");
    expect(transformer.checks).toEqual({ redis: "ok", sqlserver: "error" });
  });

  it("falls back to health when ready does not exist", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const { transformer } = bmw(await getInfrastructureStatus());

    expect(transformer.status).toBe("running");
    expect(transformer.httpStatus).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(1, new URL("http://localhost:3005/ready"), expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, new URL("http://localhost:3005/health"), expect.any(Object));
  });

  it("reports a service as down when the probe request fails", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private upstream details")));

    const { reader } = bmw(await getInfrastructureStatus());

    expect(reader.status).toBe("down");
    expect(reader).not.toHaveProperty("error");
  });

  it("does not probe unconfigured or insecure non-loopback URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(bmw(await getInfrastructureStatus()).transformer.status).toBe("unconfigured");

    process.env.BMW_TRANSFORMER_BASE_URL = "http://transformer.internal:3005";
    const { transformer } = bmw(await getInfrastructureStatus());
    expect(transformer.status).toBe("unexpected");
    expect(transformer.origin).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
