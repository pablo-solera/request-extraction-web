import { afterEach, describe, expect, it, vi } from "vitest";
import { createBmwReaderClient } from "@/lib/readers/bmw/client";

const originalBaseUrl = process.env.BMW_READER_BASE_URL;
const originalLanguage = process.env.BMW_READER_LANGUAGE;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalBaseUrl === undefined) delete process.env.BMW_READER_BASE_URL;
  else process.env.BMW_READER_BASE_URL = originalBaseUrl;
  if (originalLanguage === undefined) delete process.env.BMW_READER_LANGUAGE;
  else process.env.BMW_READER_LANGUAGE = originalLanguage;
});

describe("BMW reader client", () => {
  it("loads and caches the brand's model-series filter", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ filters: [
      { name: "developmentCode", values: [{ value: "G70" }] },
      { name: "modelSeries", values: [{ value: "7", label: "7 Series" }, { value: "X5" }] },
    ] }));
    const client = createBmwReaderClient({ fetcher, now: () => 1_000 });

    await expect(client.getSeries("BMW")).resolves.toEqual([{ value: "7", label: "7 Series" }, { value: "X5", label: "X5" }]);
    await client.getSeries("BMW");

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(new URL("http://127.0.0.1:3004/v1/models/options?brand=BMW&language=en-GB"), expect.objectContaining({ cache: "no-store", redirect: "manual" }));
  });

  it("loads and caches development codes for a selected series", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ filters: [
      { name: "developmentCode", values: [{ value: "G70", label: "G70" }, { value: "G12" }] },
      { name: "model", values: [{ value: "740I", label: "740i" }] },
    ] }));
    const client = createBmwReaderClient({ fetcher, now: () => 1_000 });

    const expected = [{ value: "G70", label: "G70" }, { value: "G12", label: "G12" }];
    await expect(client.getDevelopmentCodes("BMW", "7'")).resolves.toEqual(expected);
    await client.getDevelopmentCodes("BMW", "7'");

    expect(fetcher).toHaveBeenCalledOnce();
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(url.searchParams.get("brand")).toBe("BMW");
    expect(url.searchParams.get("modelSeries")).toBe("7'");
  });

  it("lists all typekeys regardless of validity dates and formats available dates in Spanish", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ filters: [], models: [
      { id: "11EH", label: "11EH", attributes: { typekey: "11EH", capacity: "2.998", capacityUnit: "l", power: "210", powerUnit: "kw", validFrom: "2022-07-01T00:00:00Z[UTC]", validUntil: "2026-06-30T00:00:00Z[UTC]" } },
      { id: "41HZ", label: "41HZ", attributes: { typekey: "41HZ", capacity: "2.998", capacityUnit: "l", power: "210", powerUnit: "kw", validFrom: "2026-07-01T00:00:00Z[UTC]" } },
      { id: "51HY", label: "51HY", attributes: { typekey: "51HY", validFrom: "2026-11-01T00:00:00Z[UTC]" } },
      { id: "61HX", label: "61HX", attributes: {} },
      { id: "71HW", label: "71HW", attributes: { validFrom: "not-a-date", validUntil: "2026-12-31T00:00:00Z[UTC]" } },
      { id: "invalid", label: "invalid", attributes: {} },
      { id: "6J02", label: "6J02", attributes: { typekey: "6J02", baseType: "6J92", power: "412", powerUnit: "kw" } },
      { id: "6J92", label: "6J92", attributes: { typekey: "6J92", baseType: "6J92" } },
      { id: "6J03", label: "6J03", attributes: { baseType: "bad" } },
    ] }));
    const client = createBmwReaderClient({ fetcher, now: () => Date.UTC(2026, 9, 20, 12) });

    await expect(client.getTypekeys("BMW", "7'", "G70")).resolves.toEqual([
      { value: "11EH", label: "11EH · 2,998 l · 210 kW · 01/07/2022–30/06/2026", validFrom: "01/07/2022", validUntil: "30/06/2026" },
      { value: "41HZ", label: "41HZ · 2,998 l · 210 kW · desde 01/07/2026", validFrom: "01/07/2026" },
      { value: "51HY", label: "51HY · desde 01/11/2026", validFrom: "01/11/2026" },
      { value: "61HX", label: "61HX" },
      { value: "71HW", label: "71HW · hasta 31/12/2026", validUntil: "31/12/2026" },
      { value: "6J02", label: "6J02 · 412 kW · tipo base 6J92", baseType: "6J92" },
      { value: "6J92", label: "6J92" },
      { value: "6J03", label: "6J03" },
    ]);
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(url.searchParams.get("modelSeries")).toBe("7'");
    expect(url.searchParams.get("developmentCode")).toBe("G70");
  });

  it("checks typekey availability once per typekey and keeps unknown answers uncached", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    process.env.BMW_READER_LANGUAGE = "en-GB";
    const unavailable = { typekey: "6J02", status: "unavailable", code: "CGWATB0085", suggestedTypekey: null, baseType: { typekey: "6J92", status: "available", reliable: false, differences: [{ attribute: "transmission", requested: "AUT", baseType: "MECH" }] } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(unavailable))
      .mockResolvedValueOnce(Response.json({ typekey: "6J92", status: "unknown", suggestedTypekey: null }))
      .mockResolvedValueOnce(Response.json({ typekey: "6J92", status: "available", suggestedTypekey: null }));
    const client = createBmwReaderClient({ fetcher, now: () => 1_000 });

    await expect(client.getTypekeyAvailability("BMW", "6'", "F13", "6J02")).resolves.toEqual(unavailable);
    await expect(client.getTypekeyAvailability("BMW", "6'", "F13", "6J02")).resolves.toEqual(unavailable);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/v1/models/availability");
    expect(Object.fromEntries(url.searchParams)).toEqual({ brand: "BMW", typekey: "6J02", series: "6'", developmentCode: "F13", language: "en-GB" });

    await expect(client.getTypekeyAvailability("BMW", "6'", "F13", "6J92")).resolves.toMatchObject({ status: "unknown" });
    await expect(client.getTypekeyAvailability("BMW", "6'", "F13", "6J92")).resolves.toMatchObject({ status: "available" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed availability answers and typekeys before calling the reader", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ typekey: "6J02", status: "maybe", suggestedTypekey: null }));
    const client = createBmwReaderClient({ fetcher });
    await expect(client.getTypekeyAvailability("BMW", "6'", "F13", "6J02")).rejects.toMatchObject({ code: "INVALID_READER_RESPONSE" });
    await expect(client.getTypekeyAvailability("BMW", "6'", "F13", "../..")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("submits one typekey and converts the common edition format for BMW", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    process.env.BMW_READER_LANGUAGE = "es-ES";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02", resource: "labours", status: "queued", links: { self: "/v1/labours/7be5f2af-879b-4c61-84d5-6e728f438a02" } }, { status: 202 }));
    const client = createBmwReaderClient({ fetcher });

    await expect(client.createLabour({ brand: "MINI", series: "F56", developmentCode: "F56", typekey: "11EH", axCode: "ax1", imcEdition: "05/0", language: "es-ES" })).resolves.toEqual({ requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02", status: "queued" });

    expect(fetcher).toHaveBeenCalledWith(new URL("http://localhost:3004/v1/labours"), expect.objectContaining({ method: "POST", redirect: "manual" }));
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      manufacturer: "MINI",
      axCode: "AX1",
      edition: "05_0",
      language: "es-ES",
      selection: { series: "F56", typekeys: [{ typekey: "11EH", series: "F56", family: "F56" }] },
    });
  });

  it("rejects BMW AX codes outside the 3–4 character alphanumeric rule before calling the reader", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    const fetcher = vi.fn();
    const client = createBmwReaderClient({ fetcher });
    const base = { brand: "BMW" as const, series: "7", developmentCode: "G70", typekey: "11EH", imcEdition: "05/0" };

    for (const axCode of ["AB", "ABCDE", "A_1", "A-1", "A 1"]) {
      await expect(client.createLabour({ ...base, axCode })).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the reader's NOT_AVAILABLE message and keeps other 4xx answers generic", async () => {
    process.env.BMW_READER_BASE_URL = "http://localhost:3004";
    const message = "Typekey YM13 no disponible en BMW Flat Rates (CGWATB0085)";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "NOT_AVAILABLE", message, details: { typekeys: [{ typekey: "YM13", code: "CGWATB0085" }] } } }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "VALIDATION_ERROR", message: "internal detail" } }, { status: 400 }));
    const client = createBmwReaderClient({ fetcher });
    const params = { brand: "BMW" as const, series: "6'", developmentCode: "F13", typekey: "YM13", axCode: "AX1", imcEdition: "01/0" };
    await expect(client.createLabour(params)).rejects.toMatchObject({ message, code: "TYPEKEY_NOT_AVAILABLE", retryable: false, status: 422 });
    await expect(client.createLabour(params)).rejects.toMatchObject({ message: "BMW no ha aceptado la solicitud.", code: "READER_REQUEST_FAILED" });
  });

  it("maps validated reader statuses and rejects non-loopback HTTP", async () => {
    process.env.BMW_READER_BASE_URL = "https://reader.example.test";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02", status: "rate_limited", progress: 73 }));
    const client = createBmwReaderClient({ fetcher });
    await expect(client.getLabourState("7be5f2af-879b-4c61-84d5-6e728f438a02")).resolves.toMatchObject({ status: "rate_limited", progress: 73 });

    process.env.BMW_READER_BASE_URL = "http://reader.internal:3004";
    await expect(createBmwReaderClient({ fetcher }).getSeries("BMW")).rejects.toMatchObject({ code: "READER_CONFIGURATION_ERROR" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("cancels and resumes through the common v1 labour action routes", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02", status: "cancelling" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02", resumedAtTypekey: "41HZ", queue: "bmw-extractions" }, { status: 202 }));
    const client = createBmwReaderClient({ fetcher });
    const id = "7be5f2af-879b-4c61-84d5-6e728f438a02";

    await expect(client.cancelLabour(id)).resolves.toEqual({ requestId: id, status: "cancelling" });
    await expect(client.resumeLabour(id, true)).resolves.toEqual({ requestId: id, resumedAtTypekey: "41HZ", queue: "bmw-extractions", status: "queued" });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `http://127.0.0.1:3004/v1/labours/${id}/cancel`,
      `http://127.0.0.1:3004/v1/labours/${id}/resume`,
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ force: true });
  });

  it("streams the BMW ZIP archive without following redirects", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    const archive = new Response(new Uint8Array([80, 75, 3, 4]), { headers: { "content-type": "application/zip" } });
    const fetcher = vi.fn().mockResolvedValueOnce(archive);
    const client = createBmwReaderClient({ fetcher });

    await expect(client.downloadLabourArchive("7be5f2af-879b-4c61-84d5-6e728f438a02")).resolves.toBe(archive);
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "manual", headers: { Accept: "application/zip" } }));
  });

  it("distinguishes a missing reader extraction from a generic ZIP failure and logs the reader status", async () => {
    process.env.BMW_READER_BASE_URL = "http://127.0.0.1:3004";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 }));
    const client = createBmwReaderClient({ fetcher });
    const id = "7be5f2af-879b-4c61-84d5-6e728f438a02";

    await expect(client.downloadLabourArchive(id)).rejects.toMatchObject({ message: "El reader no encuentra esta extracción.", status: 404 });
    await expect(client.downloadLabourArchive(id)).rejects.toMatchObject({ message: "BMW no ha podido generar el ZIP de la extracción.", status: 500 });
    expect(log).toHaveBeenCalledWith("BMW Reader archive download failed.", expect.objectContaining({ requestId: id, status: 404 }));
    log.mockRestore();
  });
});
