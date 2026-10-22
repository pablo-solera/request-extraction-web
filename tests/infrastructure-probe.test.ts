import { afterEach, describe, expect, it, vi } from "vitest";
import { getInfrastructureStatus } from "@/lib/infrastructure/probe";

const originalBaseUrl = process.env.BMW_READER_BASE_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalBaseUrl === undefined) delete process.env.BMW_READER_BASE_URL;
  else process.env.BMW_READER_BASE_URL = originalBaseUrl;
});

describe("BMW reader infrastructure probe", () => {
  it("reports the ready status and sanitized dependency checks", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: "ready", checks: { redis: "ok", s3: "ok" }, internal: "ignored" }));
    vi.stubGlobal("fetch", fetchMock);

    const [service] = await getInfrastructureStatus();

    expect(service).toMatchObject({ key: "bmw-reader", status: "ready", checks: { redis: "ok", s3: "ok" }, httpStatus: 200, origin: "127.0.0.1:3004" });
    expect(fetchMock).toHaveBeenCalledWith(new URL("http://127.0.0.1:3004/ready"), expect.objectContaining({ cache: "no-store", redirect: "manual" }));
  });

  it("reports failing readiness checks from a 503 response", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "unavailable", checks: { redis: "error", s3: "ok" } }, { status: 503 })));

    const [service] = await getInfrastructureStatus();

    expect(service.status).toBe("not-ready");
    expect(service.checks).toEqual({ redis: "error", s3: "ok" });
  });

  it("falls back to health when ready does not exist", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const [service] = await getInfrastructureStatus();

    expect(service.status).toBe("running");
    expect(service.httpStatus).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(1, new URL("http://localhost:3004/ready"), expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, new URL("http://localhost:3004/health"), expect.any(Object));
  });

  it("reports a service as down when the probe request fails", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private upstream details")));

    const [service] = await getInfrastructureStatus();

    expect(service.status).toBe("down");
    expect(service).not.toHaveProperty("error");
  });

  it("does not probe unconfigured or insecure non-loopback URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.BMW_READER_BASE_URL;

    const [unconfigured] = await getInfrastructureStatus();
    expect(unconfigured.status).toBe("unconfigured");

    process.env.BMW_READER_BASE_URL = "http://reader.internal:3004";
    const [insecure] = await getInfrastructureStatus();
    expect(insecure.status).toBe("unexpected");
    expect(insecure.origin).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
