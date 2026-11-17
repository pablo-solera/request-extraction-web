import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformerClient } from "@/lib/transformer/client";

const originalBmw = process.env.BMW_TRANSFORMER_BASE_URL;
const originalMercedes = process.env.MERCEDES_TRANSFORMER_BASE_URL;
const id = "7be5f2af-879b-4c61-84d5-6e728f438a02";
const info = (capabilities: Record<string, boolean>) => Response.json({
  service: "x", version: "1", contractVersion: "1.0.0", manufacturers: [],
  capabilities: Object.fromEntries(Object.entries(capabilities).map(([name, create]) => [name, { create, list: true, cancel: true, download: true }])),
});
const bothSupported = () => info({ loads: true, reports: true });
const queued = (extra = {}) => Response.json({ requestId: id, resource: "loads", status: "queued", links: { self: `/v1/loads/${id}` }, ...extra }, { status: 202 });

/** Answers GET /v1/info with the capabilities and everything else with the queued responses, in order. */
function routed(responses: Array<Response | Error>, capabilities: () => Response = bothSupported) {
  return vi.fn(async (url: URL | RequestInfo) => {
    if (String(url).endsWith("/v1/info")) return capabilities();
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  });
}
const callsTo = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([url]) => !String(url).endsWith("/v1/info"));

afterEach(() => {
  if (originalBmw === undefined) delete process.env.BMW_TRANSFORMER_BASE_URL;
  else process.env.BMW_TRANSFORMER_BASE_URL = originalBmw;
  if (originalMercedes === undefined) delete process.env.MERCEDES_TRANSFORMER_BASE_URL;
  else process.env.MERCEDES_TRANSFORMER_BASE_URL = originalMercedes;
});

describe("BMW transformer client", () => {
  it("queues a load on /v1/loads with the manufacturer, edition and a selection per typekey", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([queued({ reused: false })]);
    const client = createTransformerClient({ fetcher });

    await expect(client.createLoad({ axCode: "1XF", imcEdition: "05/0", brand: "MINI", typekeys: [{ typekey: "11EH", series: "F56", family: "F56" }] })).resolves.toEqual({ loadId: id, reused: false });

    const [url, init] = callsTo(fetcher)[0]!;
    expect(String(url)).toBe("http://localhost:3005/v1/loads");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      manufacturer: "BMW", axCode: "1XF", edition: "05/0", selection: { brand: "MINI", typekeys: [{ typekey: "11EH", series: "F56", family: "F56" }] },
    });
  });

  it("sends the extraction date of each typekey when known and reports a reused load", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([Response.json({ requestId: id, resource: "loads", status: "queued", reused: true, links: { self: "x" } })]);
    await expect(createTransformerClient({ fetcher }).createLoad({ axCode: "1XF", imcEdition: "05/0", brand: "BMW", typekeys: [{ typekey: "11EH", series: "7", family: "G70", date: "20261020" }, { typekey: "21EH", series: "7", family: "G70" }] })).resolves.toEqual({ loadId: id, reused: true });
    expect(JSON.parse(String((callsTo(fetcher)[0]![1] as RequestInit).body)).selection.typekeys).toEqual([{ typekey: "11EH", series: "7", family: "G70", date: "20261020" }, { typekey: "21EH", series: "7", family: "G70" }]);
  });

  it("parses the shared state, tolerates unknown statuses and legacy string errors, and maps failures to stable Spanish messages", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([
      Response.json({ requestId: id, resource: "loads", service: "bmw-transformer", status: "completed", stage: "marking", progress: 100, artifacts: [{ name: "a.xlsx", kind: "report", primary: true, location: "s3://x" }], error: null, details: { loadId: id, pivotKey: "k" } }),
      Response.json({ requestId: id, status: "something_new", stage: "x" }),
      Response.json({ requestId: id, status: "failed", error: { code: "INTERNAL_ERROR", message: "SQL no disponible" } }),
      Response.json({ requestId: id, status: "failed", error: "legacy" }),
      Response.json({ requestId: "", status: "" }),
      Response.json({ error: { code: "INTERNAL_ERROR", message: "internal detail" } }, { status: 500 }),
      Response.json({ error: { code: "NOT_FOUND", message: "Load not found" } }, { status: 404 }),
      new Error("offline"),
    ]);
    const client = createTransformerClient({ fetcher });

    await expect(client.getLoad(id)).resolves.toMatchObject({ status: "completed", stage: "marking", details: { pivotKey: "k" } });
    await expect(client.getLoad(id)).resolves.toMatchObject({ status: "something_new" });
    await expect(client.getLoad(id)).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR", message: "SQL no disponible" } });
    await expect(client.getLoad(id)).resolves.toMatchObject({ error: { message: "legacy" } });
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "INVALID_TRANSFORMER_RESPONSE" });
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "TRANSFORMER_REQUEST_FAILED", retryable: true, message: "El servicio de carga de datos no está disponible temporalmente." });
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "TRANSFORMER_JOB_NOT_FOUND", status: 404 });
    await expect(client.getReport(id)).rejects.toMatchObject({ code: "TRANSFORMER_UNAVAILABLE", retryable: true });
    expect(String(callsTo(fetcher)[0]![0])).toBe(`http://localhost:3005/v1/loads/${id}`);
  });

  it("shows the typekeys that are missing when the transformer answers 422 NOT_AVAILABLE at creation time", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([
      Response.json({ error: { code: "NOT_AVAILABLE", message: "missing", details: { missing: [{ typekey: "11EH" }, { typekey: "21EH" }] } } }, { status: 422 }),
      Response.json({ error: { code: "NOT_AVAILABLE", message: "missing" } }, { status: 422 }),
      Response.json({ error: { code: "VALIDATION_ERROR", message: "edition is invalid" } }, { status: 422 }),
    ]);
    const client = createTransformerClient({ fetcher });
    const input = { axCode: "1XF", imcEdition: "05/0", brand: "BMW" as const, typekeys: [{ typekey: "11EH", series: "7", family: "G70" }] };

    await expect(client.createLoad(input)).rejects.toMatchObject({ code: "TRANSFORMER_NOT_AVAILABLE", status: 422, retryable: false, message: expect.stringContaining("11EH, 21EH") });
    await expect(client.createLoad(input)).rejects.toMatchObject({ code: "TRANSFORMER_NOT_AVAILABLE", status: 422 });
    await expect(client.createLoad(input)).rejects.toMatchObject({ code: "TRANSFORMER_REQUEST_FAILED", message: "edition is invalid", retryable: false });
  });

  it("maps 409 and 413 from the transformer", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([Response.json({ error: { code: "CONFLICT", message: "not completed" } }, { status: 409 }), Response.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "big" } }, { status: 413 })]);
    const client = createTransformerClient({ fetcher });
    await expect(client.getReport(id)).rejects.toMatchObject({ code: "TRANSFORMER_CONFLICT", status: 409, message: "not completed" });
    await expect(client.getReport(id)).rejects.toMatchObject({ code: "TRANSFORMER_PAYLOAD_TOO_LARGE", status: 413 });
  });

  it("uploads the LST as multipart with the manufacturer metadata and the load id, and rejects oversized files before sending", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([queued({ resource: "reports" })]);
    const client = createTransformerClient({ fetcher });
    const load = { loadId: "load-1", axCode: "1XF", imcEdition: "05/0" };

    await expect(client.createComparison(load, { name: "x.lst", bytes: new Uint8Array([1, 2, 3]) })).resolves.toEqual({ reportId: id });
    const [url, init] = callsTo(fetcher)[0]!;
    expect(String(url)).toBe("http://localhost:3005/v1/reports");
    const body = (init as RequestInit).body as FormData;
    expect(JSON.parse(String(body.get("metadata")))).toEqual({ manufacturer: "BMW", axCode: "1XF", edition: "05/0", selection: { loadId: "load-1" } });
    expect((body.get("file") as File).name).toBe("x.lst");

    await expect(client.createComparison(load, { name: "big.lst", bytes: new Uint8Array(26 * 1024 * 1024) })).rejects.toMatchObject({ status: 413 });
    expect(callsTo(fetcher)).toHaveLength(1);
  });

  it("follows the signed download redirect of /v1/reports/{id}/download server-side and refuses other schemes", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([
      new Response(null, { status: 307, headers: { location: "http://localhost:9000/bucket/report.xlsx?sig=1" } }),
      new Response("xlsx-bytes"),
      new Response(null, { status: 307, headers: { location: "file:///etc/passwd" } }),
      new Response(null, { status: 409 }),
    ]);
    const client = createTransformerClient({ fetcher });

    const file = await client.downloadReport(id);
    expect(await file.text()).toBe("xlsx-bytes");
    expect(String(callsTo(fetcher)[0]![0])).toBe(`http://localhost:3005/v1/reports/${id}/download`);
    expect(String(callsTo(fetcher)[1]![0])).toBe("http://localhost:9000/bucket/report.xlsx?sig=1");
    await expect(client.downloadReport(id)).rejects.toMatchObject({ code: "TRANSFORMER_REQUEST_FAILED" });
    await expect(client.downloadReport(id)).rejects.toMatchObject({ status: 409 });
  });

  it("requires a configured URL that is HTTPS or loopback HTTP", async () => {
    const client = createTransformerClient({ fetcher: vi.fn() });
    delete process.env.BMW_TRANSFORMER_BASE_URL;
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "TRANSFORMER_CONFIGURATION_ERROR" });
    process.env.BMW_TRANSFORMER_BASE_URL = "http://transformer.example.com";
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "TRANSFORMER_CONFIGURATION_ERROR" });
  });

  it("accepts plain HTTP towards a Docker service name", async () => {
    const fetcher = routed([Response.json({ requestId: id, status: "completed", progress: 100 })]);
    process.env.BMW_TRANSFORMER_BASE_URL = "http://bmw-transformer-api:3005";
    await createTransformerClient({ fetcher }).getLoad(id);
    expect(String(fetcher.mock.calls[0]![0])).toBe(`http://bmw-transformer-api:3005/v1/loads/${id}`);
  });
});

describe("transformer capabilities", () => {
  it("discovers what the service supports from /v1/info and caches it", async () => {
    process.env.MERCEDES_TRANSFORMER_BASE_URL = "http://localhost:3010";
    const fetcher = routed([], () => info({ loads: false, reports: true }));
    const client = createTransformerClient({ fetcher, transformer: "mercedes" });
    await expect(client.getCapabilities()).resolves.toEqual({ loads: false, reports: true });
    await client.getCapabilities();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe("http://localhost:3010/v1/info");
  });

  it("refuses to create a resource the service does not support without calling it", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([], () => info({ loads: false, reports: true }));
    await expect(createTransformerClient({ fetcher }).createLoad({ axCode: "1XF", imcEdition: "05/0", brand: "BMW", typekeys: [] })).rejects.toMatchObject({ code: "TRANSFORMER_NOT_SUPPORTED", status: 501 });
    expect(callsTo(fetcher)).toHaveLength(0);
  });

  it("falls back to the registry when /v1/info is not available", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = routed([queued()], () => new Response("nope", { status: 404 }));
    await expect(createTransformerClient({ fetcher }).createLoad({ axCode: "1XF", imcEdition: "05/0", brand: "BMW", typekeys: [] })).resolves.toMatchObject({ loadId: id });
  });
});

describe("Mercedes transformer client", () => {
  it("creates a report as JSON with series, date and the model designations", async () => {
    process.env.MERCEDES_TRANSFORMER_BASE_URL = "http://localhost:3010";
    const fetcher = routed([queued({ resource: "reports" })], () => info({ loads: false, reports: true }));
    const client = createTransformerClient({ fetcher, transformer: "mercedes" });

    await expect(client.createReport({ axCode: "1XF", imcEdition: "05/0", language: "EN", selection: { series: "W206", date: "20261020", models: [{ modelDesignation: "C 200" }] } })).resolves.toEqual({ reportId: id, reused: false });

    const [url, init] = callsTo(fetcher)[0]!;
    expect(String(url)).toBe("http://localhost:3010/v1/reports");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ manufacturer: "Mercedes-Benz", axCode: "1XF", edition: "05/0", language: "EN", selection: { series: "W206", date: "20261020", models: [{ modelDesignation: "C 200" }] } });
  });

  it("does not support loads, polls reports and downloads from /v1/reports", async () => {
    process.env.MERCEDES_TRANSFORMER_BASE_URL = "http://localhost:3010";
    const fetcher = routed([
      Response.json({ requestId: id, status: "failed", error: { code: "INTERNAL_ERROR", message: "x" } }),
      new Response(null, { status: 307, headers: { location: "https://s3.example.com/f.xlsx" } }),
      new Response("bytes"),
    ], () => info({ loads: false, reports: true }));
    const client = createTransformerClient({ fetcher, transformer: "mercedes" });

    await expect(client.createLoad({ axCode: "1XF", imcEdition: "05/0", brand: "BMW", typekeys: [] })).rejects.toMatchObject({ code: "TRANSFORMER_NOT_SUPPORTED" });
    await expect(client.getReport(id)).resolves.toMatchObject({ status: "failed" });
    expect(await (await client.downloadReport(id)).text()).toBe("bytes");
    expect(String(callsTo(fetcher)[0]![0])).toBe(`http://localhost:3010/v1/reports/${id}`);
  });

  it("maps a 501 NOT_SUPPORTED answer", async () => {
    process.env.MERCEDES_TRANSFORMER_BASE_URL = "http://localhost:3010";
    const fetcher = routed([Response.json({ error: { code: "NOT_SUPPORTED", message: "no" } }, { status: 501 })]);
    await expect(createTransformerClient({ fetcher, transformer: "mercedes" }).getLoad(id)).rejects.toMatchObject({ code: "TRANSFORMER_NOT_SUPPORTED" });
  });
});
