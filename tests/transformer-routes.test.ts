// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderError } from "@/lib/readers/errors";

const mocks = vi.hoisted(() => ({
  requireApiIdentity: vi.fn(), uploadComparison: vi.fn(), retryRequestLoad: vi.fn(), downloadComparison: vi.fn(), getTransformerInfo: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireApiIdentity: mocks.requireApiIdentity }));
vi.mock("@/lib/transformer/service", () => mocks);
vi.mock("@/lib/transformer/client", () => ({ MAX_LST_BYTES: 25 * 1024 * 1024 }));

import { GET as downloadRoute } from "@/app/api/comparisons/[id]/download/route";
import { POST as retryRoute } from "@/app/api/requests/[id]/load/retry/route";
import { POST as uploadRoute } from "@/app/api/requests/[id]/comparisons/route";
import { GET as infoRoute } from "@/app/api/requests/transformer/route";

const id = "7be5f2af-879b-4c61-84d5-6e728f438a02";
const user = { id: "u1", oracleEmpId: 1, role: "employee" };
const context = (value = id) => ({ params: Promise.resolve({ id: value }) }) as never;
const upload = (file?: File) => {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request(`http://localhost/api/requests/${id}/comparisons`, { method: "POST", body: form });
};

describe("transformer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiIdentity.mockResolvedValue(user);
  });

  it("require a session and a valid identifier", async () => {
    mocks.requireApiIdentity.mockResolvedValue(null);
    expect((await uploadRoute(upload(new File(["x"], "a.lst")), context())).status).toBe(401);
    expect((await retryRoute(new Request("http://localhost"), context())).status).toBe(401);
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
    expect((await retryRoute(new Request("http://localhost"), context())).status).toBe(202);
    mocks.retryRequestLoad.mockRejectedValueOnce(new ReaderError("Solo se puede reintentar una carga fallida.", "LOAD_NOT_RETRYABLE", false, 409));
    expect((await retryRoute(new Request("http://localhost"), context())).status).toBe(409);
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
});
