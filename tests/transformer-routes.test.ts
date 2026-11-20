// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderError } from "@/lib/readers/errors";

const mocks = vi.hoisted(() => ({
  requireApiIdentity: vi.fn(), uploadComparison: vi.fn(), retryRequestLoad: vi.fn(), downloadComparison: vi.fn(), getTransformerInfo: vi.fn(), retryRequestReport: vi.fn(), downloadRequestReport: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireApiIdentity: mocks.requireApiIdentity }));
vi.mock("@/lib/transformer/service", () => mocks);
vi.mock("@/lib/transformer/client", () => ({ MAX_LST_BYTES: 25 * 1024 * 1024 }));

import { GET as downloadRoute } from "@/app/api/comparisons/[id]/download/route";
import { POST as retryRoute } from "@/app/api/requests/[id]/load/retry/route";
import { POST as uploadRoute } from "@/app/api/requests/[id]/comparisons/route";
import { GET as infoRoute } from "@/app/api/requests/transformer/route";
import { POST as reportRetryRoute } from "@/app/api/requests/[id]/report/retry/route";
import { GET as reportDownloadRoute } from "@/app/api/requests/[id]/report/download/route";

const id = "7be5f2af-879b-4c61-84d5-6e728f438a02";
const user = { id: "u1", oracleEmpId: 1, role: "employee" };
const context = (value = id) => ({ params: Promise.resolve({ id: value }) }) as never;
const upload = (file?: File) => {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request(`http://localhost/api/requests/${id}/comparisons`, { method: "POST", body: form, headers: { origin: "http://localhost", host: "localhost" } });
};

describe("transformer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiIdentity.mockResolvedValue(user);
  });

  it("require a session and a valid identifier", async () => {
    mocks.requireApiIdentity.mockResolvedValue(null);
    expect((await uploadRoute(upload(new File(["x"], "a.lst")), context())).status).toBe(401);
    expect((await retryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context())).status).toBe(401);
    expect((await downloadRoute(new Request("http://localhost"), context())).status).toBe(401);
    expect((await infoRoute(new Request("http://localhost/api/requests/transformer?id=" + id))).status).toBe(401);
    mocks.requireApiIdentity.mockResolvedValue(user);
    expect((await uploadRoute(upload(new File(["x"], "a.lst")), context("nope"))).status).toBe(400);
    expect((await infoRoute(new Request("http://localhost/api/requests/transformer?id=nope"))).status).toBe(400);
  });

  it("accepts an LST upload and answers 202 with the comparison id", async () => {
    mocks.uploadComparison.mockResolvedValueOnce("cmp-1");
    const response = await uploadRoute(upload(new File(["lst"], "listing.lst")), context());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: "cmp-1" });
    expect(mocks.uploadComparison).toHaveBeenCalledWith(id, user, { name: "listing.lst", bytes: expect.any(Uint8Array) });
  });

  it("rejects a missing file and maps service errors to their status", async () => {
    expect((await uploadRoute(upload(), context())).status).toBe(400);
    mocks.uploadComparison.mockRejectedValueOnce(new ReaderError("Los datos de la solicitud todavía no están cargados.", "LOAD_NOT_COMPLETED", false, 409));
    const conflict = await uploadRoute(upload(new File(["x"], "a.lst")), context());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "LOAD_NOT_COMPLETED" } });
    mocks.uploadComparison.mockRejectedValueOnce(new Error("boom"));
    expect((await uploadRoute(upload(new File(["x"], "a.lst")), context())).status).toBe(502);
  });

  it("retries a failed load and reports a conflict otherwise", async () => {
    mocks.retryRequestLoad.mockResolvedValueOnce(undefined);
    expect((await retryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context())).status).toBe(202);
    mocks.retryRequestLoad.mockRejectedValueOnce(new ReaderError("Solo se puede reintentar una carga fallida.", "LOAD_NOT_RETRYABLE", false, 409));
    expect((await retryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context())).status).toBe(409);
  });

  it("streams the Excel with a safe attachment name and private headers", async () => {
    mocks.downloadComparison.mockResolvedValueOnce({ file: new Response("xlsx-bytes", { headers: { "content-length": "10" } }), filename: "1XF_05_0_DDA_contra_BMW.xlsx" });
    const response = await downloadRoute(new Request("http://localhost"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="1XF_05_0_DDA_contra_BMW.xlsx"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("xlsx-bytes");
    mocks.downloadComparison.mockRejectedValueOnce(new ReaderError("El Excel todavía no está listo.", "COMPARISON_NOT_READY", false, 409));
    expect((await downloadRoute(new Request("http://localhost"), context())).status).toBe(409);
  });

  it("returns the transformer info for the requested requests", async () => {
    mocks.getTransformerInfo.mockResolvedValueOnce({ [id]: { requestGroupId: id, applicable: true } });
    const response = await infoRoute(new Request(`http://localhost/api/requests/transformer?id=${id}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ [id]: { requestGroupId: id, applicable: true } });
    expect(mocks.getTransformerInfo).toHaveBeenCalledWith([id], user);
  });

  it("requires a session and a valid identifier for the Mercedes-Benz report routes", async () => {
    mocks.requireApiIdentity.mockResolvedValue(null);
    expect((await reportRetryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context())).status).toBe(401);
    expect((await reportDownloadRoute(new Request("http://localhost"), context())).status).toBe(401);
    mocks.requireApiIdentity.mockResolvedValue(user);
    expect((await reportRetryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context("nope"))).status).toBe(400);
    expect((await reportDownloadRoute(new Request("http://localhost"), context("nope"))).status).toBe(400);
  });

  it("retries a failed report and maps conflicts and unexpected errors", async () => {
    mocks.retryRequestReport.mockResolvedValueOnce(undefined);
    expect((await reportRetryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context())).status).toBe(202);
    expect(mocks.retryRequestReport).toHaveBeenCalledWith(id, user);
    mocks.retryRequestReport.mockRejectedValueOnce(new ReaderError("Solo se puede reintentar un informe fallido.", "REPORT_NOT_RETRYABLE", false, 409));
    expect((await reportRetryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context())).status).toBe(409);
    mocks.retryRequestReport.mockRejectedValueOnce(new Error("boom"));
    expect((await reportRetryRoute(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), context())).status).toBe(502);
  });

  it("streams the report as {axCode}.xlsx with private headers", async () => {
    mocks.downloadRequestReport.mockResolvedValueOnce({ file: new Response("xlsx-bytes", { headers: { "content-length": "10" } }), filename: "3F6.xlsx" });
    const response = await reportDownloadRoute(new Request("http://localhost"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="3F6.xlsx"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("xlsx-bytes");
    mocks.downloadRequestReport.mockRejectedValueOnce(new ReaderError("El Excel todavía no está listo.", "REPORT_NOT_READY", false, 409));
    expect((await reportDownloadRoute(new Request("http://localhost"), context())).status).toBe(409);
    mocks.downloadRequestReport.mockRejectedValueOnce(new Error("boom"));
    expect((await reportDownloadRoute(new Request("http://localhost"), context())).status).toBe(502);
  });
});

describe("upload size limit", () => {
  it("rejects a body larger than the limit even without a trustworthy Content-Length", async () => {
    const big = new Uint8Array(25 * 1024 * 1024 + 70 * 1024);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(big); controller.close(); } });
    const request = new Request(`http://localhost/api/requests/${id}/comparisons`, {
      method: "POST", body: stream, duplex: "half", headers: { origin: "http://localhost", host: "localhost", "content-type": "multipart/form-data; boundary=x" },
    } as RequestInit);
    expect((await uploadRoute(request, context())).status).toBe(413);
    expect(mocks.uploadComparison).not.toHaveBeenCalled();
  });
});

describe("cross-origin protection", () => {
  it("rejects state-changing requests from another origin before authenticating", async () => {
    const foreign = () => new Request("http://localhost", { method: "POST", headers: { origin: "https://evil.example" } });
    expect((await retryRoute(foreign(), context())).status).toBe(403);
    expect((await reportRetryRoute(foreign(), context())).status).toBe(403);
    expect((await uploadRoute(foreign(), context())).status).toBe(403);
  });
});
