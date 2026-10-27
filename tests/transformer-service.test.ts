import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderError } from "@/lib/readers/errors";

const repository = vi.hoisted(() => Object.fromEntries([
  "attachComparisonRemote", "findLoadedTable", "claimComparisonPoll", "claimLoadPoll", "claimLoadStart", "failComparison", "getComparison", "getRequestWithRequester", "insertComparison", "listActiveComparisons", "listActiveLoads",
  "listComparisonsForRequests", "listRequestsByIds", "listRequestsReadyForLoad", "markLoadFailedToStart", "markLoadRequested", "recordLoadStartFailure", "resetFailedLoad", "updateComparisonState", "updateLoadState",
].map((name) => [name, vi.fn()])));
const organization = vi.hoisted(() => ({ isUserInCoordinatorTeam: vi.fn() }));

const notifications = vi.hoisted(() => ({ notifyLoadCompleted: vi.fn(), notifyLoadFailed: vi.fn(), notifyComparisonFailed: vi.fn(), retryPendingNotifications: vi.fn() }));
vi.mock("@/lib/mail/notifications", () => notifications);
vi.mock("@/lib/transformer/repository", () => repository);
vi.mock("@/lib/employees/org-service", () => organization);
vi.mock("@/lib/transformer/client", () => ({ getTransformerClient: vi.fn(), MAX_LST_BYTES: 25 * 1024 * 1024 }));

import { getTransformerClient } from "@/lib/transformer/client";
import { findTableConflict, downloadComparison, getTransformerInfo, reconcileTransformer, retryRequestLoad, startLoadForRequest, startPendingLoads, syncTransformerStates, uploadComparison } from "@/lib/transformer/service";

const client = { createLoad: vi.fn(), getLoad: vi.fn(), createComparison: vi.fn(), getReport: vi.fn(), downloadReport: vi.fn() };
const owner = { id: "owner", oracleEmpId: 1, role: "employee" as const };
const request = (overrides: Record<string, unknown> = {}) => ({
  requestGroupId: "g1", requesterId: "owner", axCode: "1XF", imcEdition: "05/0", brand: "BMW", manufacturerGroup: "BMW", status: "approved",
  loadStatus: null, loadAttempts: 0, loadRemoteId: null, loadError: null, loadedAt: null, ...overrides,
});
const item = (typekey: string, series = "7'", developmentCode = "G70") => ({ requestGroupId: "g1", modelCode: typekey, readerParams: { typekey, series, developmentCode } });

describe("transformer reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.claimLoadStart.mockResolvedValue({});
    repository.recordLoadStartFailure.mockResolvedValue(1);
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
    repository.markLoadFailedToStart.mockResolvedValue({ loadAttempts: 1 });
    client.createLoad
      .mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true))
      .mockRejectedValueOnce(new ReaderError("Typekeys duplicados", "TRANSFORMER_REQUEST_FAILED", false));

    await reconcileTransformer(client);

    expect(repository.markLoadFailedToStart).toHaveBeenCalledTimes(2);
    expect(notifications.notifyLoadFailed).toHaveBeenCalledWith("b", "start-1", "Typekeys duplicados");
    expect(notifications.notifyLoadFailed).toHaveBeenCalledTimes(2);
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

describe("starting a load when the last typekey completes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.claimLoadStart.mockResolvedValue({});
    repository.recordLoadStartFailure.mockResolvedValue(1);
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
  });

  it("loads only that request and queues it once", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request(), items: [item("11EH")] }]);
    client.createLoad.mockResolvedValueOnce({ loadId: "load-1", reused: false });
    repository.markLoadRequested.mockResolvedValueOnce({});

    expect(await startLoadForRequest("g1", client)).toBe(true);
    expect(repository.listRequestsReadyForLoad).toHaveBeenCalledWith(1, "g1");
    expect(client.createLoad).toHaveBeenCalledTimes(1);
  });

  it("does nothing while other typekeys are pending, when already requested or when the transformer is not configured", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([]);
    expect(await startLoadForRequest("g1", client)).toBe(false);
    expect(client.createLoad).not.toHaveBeenCalled();

    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request(), items: [item("11EH")] }]);
    client.createLoad.mockResolvedValueOnce({ loadId: "load-1", reused: true });
    repository.markLoadRequested.mockResolvedValueOnce(null);
    expect(await startLoadForRequest("g1", client)).toBe(false);

    delete process.env.BMW_TRANSFORMER_BASE_URL;
    repository.listRequestsReadyForLoad.mockClear();
    expect(await startLoadForRequest("g1", client)).toBe(false);
    expect(repository.listRequestsReadyForLoad).not.toHaveBeenCalled();
  });

  it("leaves the request for the next reconciliation when the transformer is unavailable", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request(), items: [item("11EH")] }]);
    client.createLoad.mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true));
    expect(await startLoadForRequest("g1", client)).toBe(false);
    expect(repository.markLoadFailedToStart).not.toHaveBeenCalled();
    expect(repository.recordLoadStartFailure).toHaveBeenCalledWith("g1");
  });

  it("gives up after repeated failures to reach the transformer and tells support", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request(), items: [item("11EH")] }]);
    client.createLoad.mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true));
    repository.recordLoadStartFailure.mockResolvedValueOnce(5);
    repository.markLoadFailedToStart.mockResolvedValueOnce({ loadAttempts: 0 });

    expect(await startLoadForRequest("g1", client)).toBe(false);
    expect(repository.markLoadFailedToStart).toHaveBeenCalledWith("g1", expect.stringContaining("no responde"));
    expect(notifications.notifyLoadFailed).toHaveBeenCalledWith("g1", "start-0", expect.stringContaining("no responde"));
  });

  it("does not call the transformer when another path already claimed the request", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request(), items: [item("11EH")] }]);
    repository.claimLoadStart.mockResolvedValueOnce(null);
    expect(await startLoadForRequest("g1", client)).toBe(false);
    expect(client.createLoad).not.toHaveBeenCalled();
  });
});

describe("starting pending loads and retrying failed ones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    vi.mocked(getTransformerClient).mockReturnValue(client);
  });

  it("sends ready requests that have no load and honours the claim", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValue([{ request: request(), items: [item("11EH")] }]);
    repository.claimLoadStart.mockResolvedValueOnce({}).mockResolvedValueOnce(null);
    client.createLoad.mockResolvedValue({ loadId: "load-1", reused: false });
    repository.markLoadRequested.mockResolvedValue({});

    expect(await startPendingLoads(["g1"], client)).toBe(1);
    expect(await startPendingLoads(["g1"], client)).toBe(0);
    expect(repository.claimLoadStart).toHaveBeenCalledWith("g1", expect.any(Date));
    expect(client.createLoad).toHaveBeenCalledTimes(1);
  });

  it("neither claims nor sends requests that are not ready, and keeps unavailable transformers retryable", async () => {
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([]);
    expect(await startPendingLoads(["g1"], client)).toBe(0);
    expect(repository.claimLoadStart).not.toHaveBeenCalled();

    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request(), items: [item("11EH")] }]);
    repository.claimLoadStart.mockResolvedValueOnce({});
    client.createLoad.mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true));
    expect(await startPendingLoads(["g1"], client)).toBe(0);
    expect(repository.markLoadFailedToStart).not.toHaveBeenCalled();
  });

  it("starts the load right after the technician retries a failed one", async () => {
    repository.getRequestWithRequester.mockResolvedValue({ request: request(), requester: { id: "owner" } });
    repository.resetFailedLoad.mockResolvedValueOnce({});
    repository.listRequestsReadyForLoad.mockResolvedValueOnce([{ request: request({ loadAttempts: 1 }), items: [item("11EH")] }]);
    client.createLoad.mockResolvedValueOnce({ loadId: "load-2", reused: false });
    repository.markLoadRequested.mockResolvedValueOnce({});

    await retryRequestLoad("g1", owner);

    expect(client.createLoad).toHaveBeenCalledTimes(1);
    expect(repository.markLoadRequested).toHaveBeenCalledWith("g1", "load-2");
  });

  it("starts pending loads when the history asks for the request info and reports the attempts", async () => {
    const pending = request({ loadAttempts: 1 });
    repository.listRequestsByIds.mockResolvedValue([pending]);
    repository.getRequestWithRequester.mockResolvedValue({ request: pending, requester: { id: "owner" } });
    repository.listComparisonsForRequests.mockResolvedValue([]);
    repository.listRequestsReadyForLoad.mockResolvedValue([{ request: pending, items: [item("11EH")] }]);
    repository.claimLoadStart.mockResolvedValue({});
    client.createLoad.mockResolvedValue({ loadId: "load-3", reused: false });
    repository.markLoadRequested.mockResolvedValue({});

    const info = await getTransformerInfo(["g1"], owner);

    expect(client.createLoad).toHaveBeenCalledTimes(1);
    expect(info.g1).toMatchObject({ loadAttempts: 1, applicable: true });
  });
});

describe("live transformer state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    repository.listComparisonsForRequests.mockResolvedValue([]);
    repository.updateLoadState.mockResolvedValue({});
    repository.updateComparisonState.mockResolvedValue({});
  });
  const running = (overrides: Record<string, unknown> = {}) => request({ loadStatus: "running", loadRemoteId: "load-1", ...overrides });

  it("moves a finished load to completed so the LST can be uploaded", async () => {
    repository.listRequestsByIds.mockResolvedValueOnce([running()]);
    repository.claimLoadPoll.mockResolvedValueOnce(running());
    client.getLoad.mockResolvedValueOnce({ requestId: "load-1", status: "completed", pivotKey: "k" });

    expect(await syncTransformerStates(["g1"], client)).toBe(1);
    expect(repository.claimLoadPoll).toHaveBeenCalledWith("g1", expect.any(Date));
    expect(repository.updateLoadState).toHaveBeenCalledWith("g1", "load-1", { status: "completed", error: expect.any(String) });
  });

  it("asks the transformer at most once per interval", async () => {
    repository.listRequestsByIds.mockResolvedValueOnce([running()]);
    repository.claimLoadPoll.mockResolvedValueOnce(null);
    expect(await syncTransformerStates(["g1"], client, 5000)).toBe(0);
    expect(client.getLoad).not.toHaveBeenCalled();
    const [, staleBefore] = repository.claimLoadPoll.mock.calls[0] as [string, Date];
    expect(Date.now() - staleBefore.getTime()).toBeGreaterThanOrEqual(4900);
  });

  it("follows running comparisons, skips finished work and keeps transient errors pending", async () => {
    repository.listRequestsByIds.mockResolvedValueOnce([running({ requestGroupId: "a" }), request({ requestGroupId: "b", loadStatus: "completed", loadRemoteId: "lb" })]);
    repository.claimLoadPoll.mockResolvedValueOnce(running({ requestGroupId: "a" }));
    client.getLoad.mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true));
    repository.listComparisonsForRequests.mockResolvedValueOnce([
      { id: "c1", requestGroupId: "b", status: "queued", remoteReportId: "r1" },
      { id: "c2", requestGroupId: "b", status: "completed", remoteReportId: "r2" },
    ]);
    repository.claimComparisonPoll.mockResolvedValueOnce({ id: "c1", status: "queued", remoteReportId: "r1" });
    client.getReport.mockResolvedValueOnce({ requestId: "r1", status: "completed" });

    expect(await syncTransformerStates(["a", "b"], client)).toBe(1);
    expect(repository.claimLoadPoll).toHaveBeenCalledTimes(1);
    expect(repository.updateLoadState).not.toHaveBeenCalled();
    expect(repository.claimComparisonPoll).toHaveBeenCalledTimes(1);
    expect(repository.updateComparisonState).toHaveBeenCalledWith("c1", { status: "completed", error: expect.any(String) });
  });

  it("emails the requester when a load completes and support when a load or comparison fails", async () => {
    repository.listRequestsByIds.mockResolvedValueOnce([running({ requestGroupId: "a" }), running({ requestGroupId: "b", loadRemoteId: "load-b" })]);
    repository.claimLoadPoll.mockResolvedValueOnce(running({ requestGroupId: "a" })).mockResolvedValueOnce(running({ requestGroupId: "b", loadRemoteId: "load-b" }));
    client.getLoad.mockResolvedValueOnce({ requestId: "load-1", status: "completed" }).mockResolvedValueOnce({ requestId: "load-b", status: "failed", error: "SQL no disponible" });
    repository.listComparisonsForRequests.mockResolvedValueOnce([{ id: "c1", requestGroupId: "a", status: "queued", remoteReportId: "r1" }]);
    repository.claimComparisonPoll.mockResolvedValueOnce({ id: "c1", requestGroupId: "a", status: "queued", remoteReportId: "r1" });
    client.getReport.mockResolvedValueOnce({ requestId: "r1", status: "failed", error: "LST no válido" });

    await syncTransformerStates(["a", "b"], client);

    expect(notifications.notifyLoadCompleted).toHaveBeenCalledWith("a", "load-1");
    expect(notifications.notifyLoadFailed).toHaveBeenCalledWith("b", "load-b", "SQL no disponible");
    expect(notifications.notifyComparisonFailed).toHaveBeenCalledWith("a", "c1", "LST no válido");
  });

  it("does not email again when another viewer already recorded the transition", async () => {
    repository.listRequestsByIds.mockResolvedValueOnce([running()]);
    repository.claimLoadPoll.mockResolvedValueOnce(running());
    client.getLoad.mockResolvedValueOnce({ requestId: "load-1", status: "completed" });
    repository.updateLoadState.mockResolvedValueOnce(null);
    await syncTransformerStates(["g1"], client);
    expect(notifications.notifyLoadCompleted).not.toHaveBeenCalled();
  });

  it("does nothing when the transformer is not configured", async () => {
    delete process.env.BMW_TRANSFORMER_BASE_URL;
    expect(await syncTransformerStates(["g1"], client)).toBe(0);
    expect(repository.listRequestsByIds).not.toHaveBeenCalled();
  });

  it("returns the refreshed state from the history info while a load was running", async () => {
    organization.isUserInCoordinatorTeam.mockResolvedValue(false);
    repository.getRequestWithRequester.mockResolvedValue({ request: running(), requester: { id: "owner", oracleEmpId: 1 } });
    repository.listRequestsByIds
      .mockResolvedValueOnce([running()])
      .mockResolvedValueOnce([running()])
      .mockResolvedValueOnce([request({ loadStatus: "completed", loadRemoteId: "load-1", loadedAt: new Date("2026-10-26T14:21:00Z") })]);
    repository.claimLoadPoll.mockResolvedValueOnce(running());
    client.getLoad.mockResolvedValueOnce({ requestId: "load-1", status: "completed" });
    vi.mocked(getTransformerClient).mockReturnValue(client as never);

    const info = await getTransformerInfo(["g1"], owner);
    expect(client.getLoad).toHaveBeenCalledWith("load-1");
    expect(repository.updateLoadState).toHaveBeenCalledWith("g1", "load-1", { status: "completed", error: expect.any(String) });
    expect(info.g1).toMatchObject({ loadStatus: "completed", canUpload: true });
  });
});

describe("table conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
  });

  it("reports the newest loaded table for the AX code, edition and brand", async () => {
    repository.findLoadedTable.mockResolvedValueOnce({ requestGroupId: "g9", loadStatus: "completed", loadedAt: new Date("2026-10-26T14:21:00Z") });
    expect(await findTableConflict({ axCode: "1AF", imcEdition: "01/0", brand: "MINI" })).toEqual({ loadedAt: "2026-10-26T14:21:00.000Z", loadStatus: "completed" });
    expect(repository.findLoadedTable).toHaveBeenCalledWith({ axCode: "1AF", imcEdition: "01/0", brand: "MINI" });
    repository.findLoadedTable.mockResolvedValueOnce(null);
    expect(await findTableConflict({ axCode: "1AF", imcEdition: "01/0", brand: "MINI" })).toBeNull();
  });

  it("never reports a conflict when the transformer is not configured", async () => {
    delete process.env.BMW_TRANSFORMER_BASE_URL;
    expect(await findTableConflict({ axCode: "1AF", imcEdition: "01/0", brand: "MINI" })).toBeNull();
    expect(repository.findLoadedTable).not.toHaveBeenCalled();
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
    expect(notifications.notifyComparisonFailed).not.toHaveBeenCalled();
  });

  it("tells support when the transformer itself rejects the upload", async () => {
    repository.insertComparison.mockResolvedValueOnce({ id: "cmp-2" });
    repository.failComparison.mockResolvedValueOnce({});
    client.createComparison.mockRejectedValueOnce(new ReaderError("El fichero no es un listado válido.", "TRANSFORMER_REQUEST_FAILED", false));
    await expect(uploadComparison("g1", owner, { name: "a.lst", bytes: new Uint8Array([1]) }, client)).rejects.toMatchObject({ code: "TRANSFORMER_REQUEST_FAILED" });
    expect(notifications.notifyComparisonFailed).toHaveBeenCalledWith("g1", "cmp-2", "El fichero no es un listado válido.");
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
