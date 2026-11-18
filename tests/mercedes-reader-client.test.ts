import { afterEach, describe, expect, it, vi } from "vitest";
import { createMercedesReaderClient } from "@/lib/readers/mercedes/client";
import { mapMercedesReaderStatus } from "@/lib/readers/registry";

const originalBaseUrl = process.env.MERCEDES_READER_BASE_URL;
const requestId = "7be5f2af-879b-4c61-84d5-6e728f438a02";

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.MERCEDES_READER_BASE_URL;
  else process.env.MERCEDES_READER_BASE_URL = originalBaseUrl;
});

const options = {
  manufacturer: "Mercedes-Benz",
  filters: [{ name: "productGroup", label: "Product group", values: [{ value: "PC", label: "PC" }, { value: "VAN", label: "VAN" }] }],
  models: [
    { id: "m1", label: "223159 S 500", attributes: { modelDesignation: "223159", mdcIds: ["m1", "m2"], productGroup: "PC" } },
    { id: "m3", label: "223161 S 580", attributes: { modelDesignation: "223161", productGroup: "PC" } },
    { id: "m4", label: "duplicate", attributes: { modelDesignation: "223161" } },
    { id: "m5", label: "no designation", attributes: {} },
  ],
};

const createInput = { series: "S-Class 223", date: "20261118", modelDesignations: ["223159"], axCode: "ax1", imcEdition: "04/0" };

describe("Mercedes reader client", () => {
  it("loads and caches the series filter", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://127.0.0.1:3005";
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ filters: [{ name: "series", values: [{ value: "S-Class 223" }, { value: "GLB 248", label: "GLB" }] }], models: [] }));
    const client = createMercedesReaderClient({ fetcher, now: () => 1_000 });

    await expect(client.getSeries()).resolves.toEqual([{ value: "S-Class 223", label: "S-Class 223" }, { value: "GLB 248", label: "GLB" }]);
    await client.getSeries();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(new URL("http://127.0.0.1:3005/v1/models/options?manufacturer=Mercedes-Benz"), expect.objectContaining({ cache: "no-store", redirect: "manual" }));
  });

  it("rejects a response without the series filter", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://127.0.0.1:3005";
    const client = createMercedesReaderClient({ fetcher: vi.fn().mockResolvedValue(Response.json({ filters: [] })) });
    await expect(client.getSeries()).rejects.toMatchObject({ code: "INVALID_READER_RESPONSE" });
  });

  it("lists one model per designation with the product-group filter and sends the cascade as query", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://127.0.0.1:3005";
    const fetcher = vi.fn().mockResolvedValue(Response.json(options));
    const client = createMercedesReaderClient({ fetcher });

    await expect(client.getModels("S-Class 223", "PC")).resolves.toEqual({
      productGroups: [{ value: "PC", label: "PC" }, { value: "VAN", label: "VAN" }],
      models: [{ value: "223159", label: "223159 S 500", productGroup: "PC" }, { value: "223161", label: "223161 S 580", productGroup: "PC" }],
    });
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(Object.fromEntries(url.searchParams)).toEqual({ manufacturer: "Mercedes-Benz", series: "S-Class 223", productGroup: "PC" });
  });

  it("submits the model with the explicit date and the underscore edition", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requestId, status: "queued" }, { status: 202 }));
    const client = createMercedesReaderClient({ fetcher });

    await expect(client.createLabour(createInput)).resolves.toEqual({ requestId, status: "queued" });
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      manufacturer: "Mercedes-Benz", axCode: "AX1", edition: "04_0",
      selection: { date: "20261118", series: "S-Class 223", models: [{ modelDesignation: "223159" }] },
    });
  });

  it("validates the create input before calling the reader", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn();
    const client = createMercedesReaderClient({ fetcher });
    await expect(client.createLabour({ ...createInput, axCode: "A" })).rejects.toThrow();
    await expect(client.createLabour({ ...createInput, date: "2026-11-18" })).rejects.toThrow();
    await expect(client.createLabour({ ...createInput, modelDesignations: [] })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("turns NOT_AVAILABLE (422) of a create into a non-retryable model error", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://localhost:3005";
    const body = { error: { code: "NOT_AVAILABLE", message: "Unknown model 223159", details: { models: ["223159"] } } };
    const client = createMercedesReaderClient({ fetcher: vi.fn().mockResolvedValue(Response.json(body, { status: 422 })) });
    await expect(client.createLabour(createInput)).rejects.toMatchObject({ code: "MODEL_NOT_AVAILABLE", status: 422, retryable: false, message: "Unknown model 223159" });
  });

  it("maps 409, 501, 404 and 5xx answers", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://localhost:3005";
    const answer = (status: number, code: string, message = "x") => createMercedesReaderClient({ fetcher: vi.fn().mockResolvedValue(Response.json({ error: { code, message } }, { status })) });
    await expect(answer(409, "CONFLICT", "worker active").resumeLabour(requestId)).rejects.toMatchObject({ code: "READER_CONFLICT", message: "worker active" });
    await expect(answer(501, "NOT_SUPPORTED").getLabourState(requestId)).rejects.toMatchObject({ code: "READER_NOT_SUPPORTED", status: 501 });
    await expect(answer(404, "NOT_FOUND").getLabourState(requestId)).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });
    await expect(answer(404, "NOT_FOUND").getSeries()).rejects.toMatchObject({ code: "MODEL_OPTIONS_UNAVAILABLE" });
    await expect(answer(503, "UNAVAILABLE").getLabourState(requestId)).rejects.toMatchObject({ code: "READER_REQUEST_FAILED", retryable: true });
    await expect(answer(400, "VALIDATION_ERROR").getLabourState(requestId)).rejects.toMatchObject({ code: "READER_REQUEST_FAILED", retryable: false });
  });

  it("reads the state with the extraction date and handles cancel and resume", async () => {
    process.env.MERCEDES_READER_BASE_URL = "http://localhost:3005";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ requestId, status: "completed", progress: 100, request: { selection: { date: "20261118", series: "S" } } }))
      .mockResolvedValueOnce(Response.json({ requestId, status: "cancelling" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ requestId, status: "queued" }, { status: 202 }));
    const client = createMercedesReaderClient({ fetcher });

    await expect(client.getLabourState(requestId)).resolves.toMatchObject({ status: "completed", request: { selection: { date: "20261118" } } });
    await expect(client.cancelLabour(requestId)).resolves.toEqual({ requestId, status: "cancelling" });
    await expect(client.resumeLabour(requestId, true)).resolves.toMatchObject({ requestId, status: "queued" });
    expect(JSON.parse(String((fetcher.mock.calls[2]![1] as RequestInit).body))).toEqual({ force: true });
  });

  it("fails on missing configuration, untrusted hosts, redirects and unreachable readers", async () => {
    delete process.env.MERCEDES_READER_BASE_URL;
    await expect(createMercedesReaderClient({ fetcher: vi.fn() }).getSeries()).rejects.toMatchObject({ code: "READER_CONFIGURATION_ERROR" });
    process.env.MERCEDES_READER_BASE_URL = "http://reader.example.com";
    await expect(createMercedesReaderClient({ fetcher: vi.fn() }).getSeries()).rejects.toMatchObject({ code: "READER_CONFIGURATION_ERROR" });
    process.env.MERCEDES_READER_BASE_URL = "http://localhost:3005";
    await expect(createMercedesReaderClient({ fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 302 })) }).getLabourState(requestId)).rejects.toMatchObject({ code: "INVALID_READER_REDIRECT" });
    await expect(createMercedesReaderClient({ fetcher: vi.fn().mockRejectedValue(new Error("down")) }).getLabourState(requestId)).rejects.toMatchObject({ code: "READER_UNAVAILABLE", retryable: true });
  });
});

describe("mapMercedesReaderStatus", () => {
  it.each([["queued", "pending"], ["running", "running"], ["rate_limited", "running"], ["paused", "running"], ["cancelling", "running"], ["completed", "completed"], ["failed", "failed"], ["cancelled", "cancelled"]] as const)("maps %s to %s", (status, expected) => {
    expect(mapMercedesReaderStatus({ requestId, status })).toBe(expected);
  });
});
