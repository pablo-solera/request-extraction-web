import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRenaultFamiliesCache, cancelRenaultLabour, createRenaultLabour, getRenaultDownloadLocation, getRenaultLabourFamilies, getRenaultLabourState, resumeRenaultLabour } from "@/lib/readers/renault/client";

const originalBaseUrl = process.env.RENAULT_READER_BASE_URL;

afterEach(() => {
  clearRenaultFamiliesCache();
  vi.unstubAllGlobals();
  if (originalBaseUrl === undefined) delete process.env.RENAULT_READER_BASE_URL;
  else process.env.RENAULT_READER_BASE_URL = originalBaseUrl;
});

describe("Renault shared reader-core adapter", () => {
  it("uses advertised v1 create, status, cancel, resume and download routes", async () => {
    process.env.RENAULT_READER_BASE_URL = "http://127.0.0.1:3010";
    const requestId = "7be5f2af-879b-4c61-84d5-6e728f438a02";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ capabilities: { labours: { create: true, list: true, cancel: true, resume: true, download: true }, models: { options: true } } }))
      .mockResolvedValueOnce(Response.json({ manufacturer: "Renault", appliedFilters: { brand: "Dacia" }, filters: [{ name: "family", values: [{ value: "B52", label: "Sandero" }, { value: "HJD", label: "Duster" }] }], models: [], complete: true }))
      .mockResolvedValueOnce(Response.json({ requestId, status: "cancelling" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ requestId, queue: "renault-jobs" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ requestId, status: "paused", progress: 37, details: { stalled: true }, error: null }))
      .mockResolvedValueOnce(Response.json({ requestId, status: "queued" }, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://downloads.example.test/result.zip?sig=test" } }));
    vi.stubGlobal("fetch", fetcher);

    await expect(getRenaultLabourFamilies("Dacia")).resolves.toEqual([{ value: "B52", label: "Sandero" }, { value: "HJD", label: "Duster" }]);
    await expect(cancelRenaultLabour(requestId)).resolves.toMatchObject({ requestId, status: "cancelling" });
    await expect(resumeRenaultLabour(requestId, true)).resolves.toMatchObject({ requestId, status: "queued" });
    await expect(getRenaultLabourState(requestId)).resolves.toMatchObject({ status: "paused", progress: 37, details: { stalled: true } });
    await expect(createRenaultLabour({ brand: "Dacia", family: "X98", axCode: "AX12", edition: "05/0", language: "es", format: "TM01", range: "active" })).resolves.toMatchObject({ requestId, status: "queued" });
    await expect(getRenaultDownloadLocation(requestId)).resolves.toBeInstanceOf(URL);

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:3010/v1/info",
      "http://127.0.0.1:3010/v1/models/options?manufacturer=Renault&brand=Dacia",
      `http://127.0.0.1:3010/v1/labours/${requestId}/cancel`,
      `http://127.0.0.1:3010/v1/labours/${requestId}/resume`,
      `http://127.0.0.1:3010/v1/labours/${requestId}`,
      "http://127.0.0.1:3010/v1/labours",
      `http://127.0.0.1:3010/v1/labours/${requestId}/download`,
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({});
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({ force: true });
    expect(JSON.parse(String(fetcher.mock.calls[5]?.[1]?.body))).toMatchObject({
      manufacturer: "Dacia",
      axCode: "AX12",
      edition: "05_0",
      language: "es",
      selection: { family: "X98", format: "TM01", range: "active" },
    });
    expect(fetcher.mock.calls[6]?.[1]?.redirect).toBe("manual");
  });
});

describe("Renault families cache", () => {
  it("serves repeated family lookups for the same brand from memory", async () => {
    process.env.RENAULT_READER_BASE_URL = "http://127.0.0.1:3010";
    const fetcher = vi.fn(async (url: unknown) => String(url).endsWith("/v1/info")
      ? Response.json({ capabilities: { labours: { create: true, list: true, cancel: true, resume: true, download: true }, models: { options: true } } })
      : Response.json({ filters: [{ name: "family", values: [{ value: "B52", label: "Sandero" }] }], models: [] }));
    vi.stubGlobal("fetch", fetcher);

    const first = await getRenaultLabourFamilies("Dacia");
    const second = await getRenaultLabourFamilies("Dacia");

    expect(second).toEqual(first);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/v1/models/options"))).toHaveLength(1);
  });
});

describe("Renault download location", () => {
  const requestId = "7be5f2af-879b-4c61-84d5-6e728f438a02";
  const withLocation = (location: string) => {
    process.env.RENAULT_READER_BASE_URL = "http://127.0.0.1:3010";
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).endsWith("/v1/info")
      ? Response.json({ capabilities: { labours: { create: true, list: true, cancel: true, resume: true, download: true }, models: { options: true } } })
      : new Response(null, { status: 307, headers: { location } })));
  };

  it("accepts the signed link of the reader's own S3, whatever its host", async () => {
    withLocation("https://s3.example.internal/bucket/result.zip?sig=1");
    await expect(getRenaultDownloadLocation(requestId)).resolves.toEqual(new URL("https://s3.example.internal/bucket/result.zip?sig=1"));
  });

  it.each([
    ["credentials in the URL", "https://user:pw@s3.example.internal/result.zip"],
    ["plain HTTP to a remote host", "http://s3.example.internal/result.zip"],
    ["a private address", "https://10.0.0.5/result.zip"],
    ["a metadata address", "https://169.254.169.254/latest/meta-data"],
    ["another scheme", "file:///etc/passwd"],
  ])("refuses %s", async (_name, location) => {
    withLocation(location);
    await expect(getRenaultDownloadLocation(requestId)).rejects.toThrow();
  });
});
