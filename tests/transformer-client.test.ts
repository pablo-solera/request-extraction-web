import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformerClient } from "@/lib/transformer/client";

const originalUrl = process.env.BMW_TRANSFORMER_BASE_URL;
const id = "7be5f2af-879b-4c61-84d5-6e728f438a02";

afterEach(() => {
  if (originalUrl === undefined) delete process.env.BMW_TRANSFORMER_BASE_URL;
  else process.env.BMW_TRANSFORMER_BASE_URL = originalUrl;
});

describe("transformer client", () => {
  it("queues a load with the stored edition and series and family per typekey", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requestId: id, status: "queued", reused: false }, { status: 202 }));
    const client = createTransformerClient({ fetcher });

    await expect(client.createLoad({ axCode: "1XF", imcEdition: "05/0", brand: "MINI", typekeys: [{ typekey: "11EH", series: "F56", family: "F56" }] })).resolves.toEqual({ loadId: id, reused: false });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3005/loads");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ axCode: "1XF", edition: "05/0", manufacturer: "MINI", brand: "MINI", typekeys: [{ typekey: "11EH", series: "F56", family: "F56" }] });
  });

  it("sends the extraction date of each typekey when known", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requestId: id, status: "queued", reused: false }, { status: 202 }));
    await createTransformerClient({ fetcher }).createLoad({ axCode: "1XF", imcEdition: "05/0", brand: "BMW", typekeys: [{ typekey: "11EH", series: "7", family: "G70", date: "20261020" }, { typekey: "21EH", series: "7", family: "G70" }] });
    expect(JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body)).typekeys).toEqual([{ typekey: "11EH", series: "7", family: "G70", date: "20261020" }, { typekey: "21EH", series: "7", family: "G70" }]);
  });

  it("validates states and maps transformer errors to stable Spanish messages", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ requestId: id, status: "completed", progress: 100, pivotKey: "k" }))
      .mockResolvedValueOnce(Response.json({ requestId: id, status: "weird" }))
      .mockResolvedValueOnce(Response.json({ error: "internal detail" }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ error: "Load not found" }, { status: 404 }))
      .mockRejectedValueOnce(new Error("offline"));
    const client = createTransformerClient({ fetcher });

    await expect(client.getLoad(id)).resolves.toMatchObject({ status: "completed", pivotKey: "k" });
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "INVALID_TRANSFORMER_RESPONSE" });
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "TRANSFORMER_REQUEST_FAILED", retryable: true, message: "El servicio de carga de datos no está disponible temporalmente." });
    await expect(client.getLoad(id)).rejects.toMatchObject({ code: "TRANSFORMER_JOB_NOT_FOUND", status: 404 });
    await expect(client.getReport(id)).rejects.toMatchObject({ code: "TRANSFORMER_UNAVAILABLE", retryable: true });
  });

  it("uploads the LST with only the load id as metadata and rejects oversized files before sending", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requestId: id, status: "queued" }, { status: 202 }));
    const client = createTransformerClient({ fetcher });

    await expect(client.createComparison("load-1", { name: "x.lst", bytes: new Uint8Array([1, 2, 3]) })).resolves.toEqual({ reportId: id });
    const body = (fetcher.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(JSON.parse(String(body.get("metadata")))).toEqual({ loadId: "load-1" });
    expect((body.get("file") as File).name).toBe("x.lst");

    await expect(client.createComparison("load-1", { name: "big.lst", bytes: new Uint8Array(26 * 1024 * 1024) })).rejects.toMatchObject({ status: 413 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("follows the signed download redirect server-side and refuses other schemes", async () => {
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "http://localhost:9000/bucket/report.xlsx?sig=1" } }))
      .mockResolvedValueOnce(new Response("xlsx-bytes"))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "file:///etc/passwd" } }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const client = createTransformerClient({ fetcher });

    const file = await client.downloadReport(id);
    expect(await file.text()).toBe("xlsx-bytes");
    expect(String(fetcher.mock.calls[1]![0])).toBe("http://localhost:9000/bucket/report.xlsx?sig=1");
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
});
