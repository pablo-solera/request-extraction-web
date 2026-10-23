import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderError } from "@/lib/readers/errors";

const repository = vi.hoisted(() => Object.fromEntries([
  "attachComparisonRemote", "failComparison", "getComparison", "getRequestWithRequester", "insertComparison", "listActiveComparisons", "listActiveLoads",
  "listComparisonsForRequests", "listRequestsByIds", "listRequestsReadyForLoad", "markLoadFailedToStart", "markLoadRequested", "resetFailedLoad", "updateComparisonState", "updateLoadState",
].map((name) => [name, vi.fn()])));
const organization = vi.hoisted(() => ({ isUserInCoordinatorTeam: vi.fn() }));

vi.mock("@/lib/transformer/repository", () => repository);
vi.mock("@/lib/employees/org-service", () => organization);
vi.mock("@/lib/transformer/client", () => ({ getTransformerClient: vi.fn(), MAX_LST_BYTES: 25 * 1024 * 1024 }));

import { downloadComparison, getTransformerInfo, reconcileTransformer, retryRequestLoad, uploadComparison } from "@/lib/transformer/service";

const client = { createLoad: vi.fn(), getLoad: vi.fn(), createComparison: vi.fn(), getReport: vi.fn(), downloadReport: vi.fn() };
const owner = { id: "owner", oracleEmpId: 1, role: "employee" as const };
const request = (overrides: Record<string, unknown> = {}) => ({
  requestGroupId: "g1", requesterId: "owner", axCode: "1XF", imcEdition: "05/0", brand: "BMW", manufacturerGroup: "BMW", status: "approved",
  loadStatus: null, loadRemoteId: null, loadError: null, loadedAt: null, ...overrides,
});
const item = (typekey: string, series = "7'", developmentCode = "G70") => ({ requestGroupId: "g1", modelCode: typekey, readerParams: { typekey, series, developmentCode } });

describe("transformer reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    for (const name of ["listRequestsReadyForLoad", "listActiveLoads", "listActiveComparisons"]) repository[name]!.mockResolvedValue([]);
    organization.isUserInCoordinatorTeam.mockResolvedValue(false);
  });

  it("does nothing when the transformer is not configured", async () => {
    delete process.env.BMW_TRANSFORMER_BASE_URL;
    expect(await reconcileTransformer(client)).toEqual({ started: 0, updated: 0 });
    expect(repository.listRequestsReadyForLoad).not.toHaveBeenCalled();
  });

  it("starts a load with every typekey's own series and development code", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request(), items: [item("11EH"), item("6J92", "6'", "F13")] }]);
    client.createLoad.mockResolvedValueOnce({ loadId: "load-1", reused: false });
    repository.markLoadRequested.mockResolvedValueOnce({});

    expect(await reconcileTransformer(client)).toEqual({ started: 1, updated: 0 });
    expect(client.createLoad).toHaveBeenCalledWith({ axCode: "1XF", imcEdition: "05/0", brand: "BMW", typekeys: [
      { typekey: "11EH", series: "7'", family: "G70" }, { typekey: "6J92", series: "6'", family: "F13" },
    ] });
    expect(repository.markLoadRequested).toHaveBeenCalledWith("g1", "load-1");
  });

  it("retries later when the transformer is unavailable and fails permanently on other errors or incomplete data", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([
      { request: request({ requestGroupId: "a" }), items: [item("11EH")] },
      { request: request({ requestGroupId: "b" }), items: [item("11EH")] },
      { request: request({ requestGroupId: "c" }), items: [{ requestGroupId: "c", modelCode: "X", readerParams: { typekey: "X" } }] },
    ]);
    client.createLoad
      .mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true))
      .mockRejectedValueOnce(new ReaderError("Typekeys duplicados", "TRANSFORMER_REQUEST_FAILED", false));

    await reconcileTransformer(client);

    expect(repository.markLoadFailedToStart).toHaveBeenCalledTimes(2);
    expect(repository.markLoadFailedToStart).toHaveBeenCalledWith("b", "Typekeys duplicados");
    expect(repository.markLoadFailedToStart).toHaveBeenCalledWith("c", "La solicitud no tiene los datos necesarios para cargarla.");
    expect(repository.markLoadRequested).not.toHaveBeenCalled();
  });

  it("follows active loads and comparisons and keeps transient errors pending", async () => {
    repository.listActiveLoads.mockResolvedValueOnce([
      request({ requestGroupId: "a", loadStatus: "queued", loadRemoteId: "la" }),
      request({ requestGroupId: "b", loadStatus: "running", loadRemoteId: "lb" }),
      request({ requestGroupId: "c", loadStatus: "running", loadRemoteId: "lc" }),
      request({ requestGroupId: "d", loadStatus: "running", loadRemoteId: "ld" }),
    ]);
    client.getLoad
      .mockResolvedValueOnce({ requestId: "la", status: "importing" })
      .mockResolvedValueOnce({ requestId: "lb", status: "failed", error: "SQL no disponible" })
      .mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true))
      .mockRejectedValueOnce(new ReaderError("El trabajo del transformer ya no está disponible.", "TRANSFORMER_JOB_NOT_FOUND", false, 404));
    repository.updateLoadState.mockResolvedValue({});
    repository.listActiveComparisons.mockResolvedValueOnce([{ id: "cmp", status: "queued", remoteReportId: "r1" }]);
    client.getReport.mockResolvedValueOnce({ requestId: "r1", status: "completed" });
    repository.updateComparisonState.mockResolvedValue({});

    const result = await reconcileTransformer(client);

    expect(repository.updateLoadState).toHaveBeenCalledWith("a", "la", { status: "running", error: expect.any(String) });
    expect(repository.updateLoadState).toHaveBeenCalledWith("b", "lb", { status: "failed", error: "SQL no disponible" });
    expect(repository.updateLoadState).toHaveBeenCalledWith("d", "ld", { status: "failed", error: "El trabajo del transformer ya no está disponible." });
    expect(repository.updateLoadState).not.toHaveBeenCalledWith("c", expect.anything(), expect.anything());
    expect(repository.updateComparisonState).toHaveBeenCalledWith("cmp", { status: "completed", error: expect.any(String) });
    expect(result.updated).toBe(3);
  });
});

describe("transformer request actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    organization.isUserInCoordinatorTeam.mockResolvedValue(false);
    repository.getRequestWithRequester.mockResolvedValue({ request: request({ loadStatus: "completed", loadRemoteId: "load-1" }), requester: { id: "owner", oracleEmpId: 1 } });
  });

  it("uploads an LST against the completed load of a request the actor manages", async () => {
    repository.insertComparison.mockResolvedValueOnce({ id: "cmp-1" });
    client.createComparison.mockResolvedValueOnce({ reportId: "report-1" });

    expect(await uploadComparison("g1", owner, { name: "Listing.LST", bytes: new Uint8Array([1]) }, client)).toBe("cmp-1");
    expect(client.createComparison).toHaveBeenCalledWith("load-1", { name: "Listing.LST", bytes: expect.any(Uint8Array) });
    expect(repository.attachComparisonRemote).toHaveBeenCalledWith("cmp-1", "report-1");
  });

  it("rejects uploads before the load is completed, with bad files, or by someone who cannot manage the request", async () => {
    repository.getRequestWithRequester.mockResolvedValueOnce({ request: request({ loadStatus: "running", loadRemoteId: "load-1" }), requester: { id: "owner", oracleEmpId: 1 } });
    await expect(uploadComparison("g1", owner, { name: "a.lst", bytes: new Uint8Array([1]) }, client)).rejects.toMatchObject({ status: 409 });
    await expect(uploadComparison("g1", owner, { name: "a.txt", bytes: new Uint8Array([1]) }, client)).rejects.toMatchObject({ code: "INVALID_LST_FILE" });
    await expect(uploadComparison("g1", owner, { name: "a.lst", bytes: new Uint8Array(0) }, client)).rejects.toMatchObject({ code: "INVALID_LST_FILE" });
    await expect(uploadComparison("g1", { id: "other", oracleEmpId: 2, role: "employee" }, { name: "a.lst", bytes: new Uint8Array([1]) }, client)).rejects.toMatchObject({ status: 404 });
    expect(repository.insertComparison).not.toHaveBeenCalled();
  });

  it("marks the comparison failed when the transformer rejects the upload", async () => {
    repository.insertComparison.mockResolvedValueOnce({ id: "cmp-1" });
    client.createComparison.mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true));
    await expect(uploadComparison("g1", owner, { name: "a.lst", bytes: new Uint8Array([1]) }, client)).rejects.toMatchObject({ code: "TRANSFORMER_UNAVAILABLE" });
    expect(repository.failComparison).toHaveBeenCalledWith("cmp-1", "down");
  });

  it("lets admins and the coordinator of the requester's team manage a request", async () => {
    repository.resetFailedLoad.mockResolvedValue({});
    await retryRequestLoad("g1", { id: "admin", oracleEmpId: 9, role: "admin" });
    organization.isUserInCoordinatorTeam.mockResolvedValueOnce(true);
    await retryRequestLoad("g1", { id: "coord", oracleEmpId: 8, role: "coordinator" });
    expect(repository.resetFailedLoad).toHaveBeenCalledTimes(2);
    repository.resetFailedLoad.mockResolvedValueOnce(null);
    await expect(retryRequestLoad("g1", owner)).rejects.toMatchObject({ status: 409 });
  });

  it("downloads only completed comparisons and names the Excel after the request", async () => {
    repository.getComparison.mockResolvedValue({ id: "cmp-1", requestGroupId: "g1", status: "completed", remoteReportId: "report-1" });
    client.downloadReport.mockResolvedValueOnce(new Response("xlsx"));
    const result = await downloadComparison("cmp-1", owner, client);
    expect(result.filename).toBe("1XF_05_0_DDA_contra_BMW.xlsx");
    expect(client.downloadReport).toHaveBeenCalledWith("report-1");

    repository.getComparison.mockResolvedValue({ id: "cmp-2", requestGroupId: "g1", status: "running", remoteReportId: "report-2" });
    await expect(downloadComparison("cmp-2", owner, client)).rejects.toMatchObject({ status: 409 });
    repository.getComparison.mockResolvedValue(null);
    await expect(downloadComparison("missing", owner, client)).rejects.toMatchObject({ status: 404 });
  });

  it("builds the per-request info only for requests the actor can manage", async () => {
    repository.listRequestsByIds.mockResolvedValueOnce([
      request({ loadStatus: "completed", loadRemoteId: "load-1", loadedAt: new Date("2026-10-23T10:00:00Z") }),
      request({ requestGroupId: "g2", requesterId: "someone-else" }),
    ]);
    repository.getRequestWithRequester.mockImplementation(async (id: string) => ({ request: request({ requestGroupId: id, requesterId: id === "g2" ? "someone-else" : "owner" }), requester: { id: "owner", oracleEmpId: id === "g2" ? 2 : 1 } }));
    repository.listComparisonsForRequests.mockResolvedValueOnce([{ id: "cmp-1", requestGroupId: "g1", sourceFilename: "a.lst", status: "completed", errorMessage: null, createdAt: new Date("2026-10-23T11:00:00Z") }]);

    const info = await getTransformerInfo(["g1", "g2"], owner);

    expect(Object.keys(info)).toEqual(["g1"]);
    expect(info.g1).toMatchObject({ applicable: true, loadStatus: "completed", canUpload: true, canRetryLoad: false, comparisons: [{ id: "cmp-1", filename: "a.lst", downloadReady: true }] });
  });
});
