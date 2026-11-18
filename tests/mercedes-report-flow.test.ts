import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderError } from "@/lib/readers/errors";

const repository = vi.hoisted(() => Object.fromEntries([
  "claimReportPoll", "claimReportStart", "getRequestWithRequester", "listActiveReports", "listRequestsByIds", "listRequestsReadyForReport", "listComparisonsForRequests",
  "markReportFailedToStart", "markReportRequested", "recordReportStartFailure", "resetFailedReport", "updateReportState",
  "listRequestsReadyForLoad", "listActiveLoads", "listActiveComparisons",
].map((name) => [name, vi.fn()])));
const organization = vi.hoisted(() => ({ isUserInCoordinatorTeam: vi.fn() }));
const notifications = vi.hoisted(() => ({ notifyLoadCompleted: vi.fn(), notifyLoadFailed: vi.fn(), notifyComparisonFailed: vi.fn(), notifyReportFailed: vi.fn(), retryPendingNotifications: vi.fn() }));

vi.mock("@/lib/mail/notifications", () => notifications);
vi.mock("@/lib/transformer/repository", () => repository);
vi.mock("@/lib/employees/org-service", () => organization);
vi.mock("@/lib/transformer/client", () => ({ getTransformerClient: vi.fn(), MAX_LST_BYTES: 25 * 1024 * 1024 }));

import { getTransformerClient } from "@/lib/transformer/client";
import { downloadRequestReport, getTransformerInfo, reconcileTransformer, retryRequestReport, startPendingReports, startReportForRequest, syncTransformerStates } from "@/lib/transformer/service";

const client = { getCapabilities: vi.fn(), createLoad: vi.fn(), getLoad: vi.fn(), createComparison: vi.fn(), createReport: vi.fn(), getReport: vi.fn(), downloadReport: vi.fn() };
const owner = { id: "owner", oracleEmpId: 1, role: "employee" as const };
const request = (overrides: Record<string, unknown> = {}) => ({
  requestGroupId: "g1", requesterId: "owner", axCode: "3F6", imcEdition: "04/0", brand: "Mercedes-Benz", manufacturerGroup: "Mercedes", status: "approved",
  loadStatus: null, loadAttempts: 0, reportStatus: null, reportAttempts: 0, reportRemoteId: null, reportError: null, reportCompletedAt: null, reportDownloadable: false, ...overrides,
});
const item = (modelCode: string, overrides: Record<string, unknown> = {}) => ({ requestGroupId: "g1", modelCode, dataDate: "20261117", readerParams: { series: "GLB 248", date: "20261116" }, ...overrides });
const running = (overrides: Record<string, unknown> = {}) => request({ reportStatus: "running", reportRemoteId: "rep-1", ...overrides });
const managed = (value: unknown) => ({ request: value, requester: { id: "owner", oracleEmpId: 1 } });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.MERCEDES_TRANSFORMER_BASE_URL = "http://localhost:3006";
  delete process.env.BMW_TRANSFORMER_BASE_URL;
  repository.claimReportStart!.mockResolvedValue({});
  repository.recordReportStartFailure!.mockResolvedValue(1);
  repository.updateReportState!.mockResolvedValue({});
  repository.listComparisonsForRequests!.mockResolvedValue([]);
  for (const name of ["listActiveReports", "listRequestsReadyForReport", "listRequestsReadyForLoad", "listActiveLoads", "listActiveComparisons"]) repository[name]!.mockResolvedValue([]);
  organization.isUserInCoordinatorTeam.mockResolvedValue(false);
});

describe("starting the Mercedes-Benz report", () => {
  it("creates it from the series, the reader's extraction date, the model designations and the slash edition", async () => {
    repository.listRequestsReadyForReport!.mockResolvedValueOnce([{ request: request(), items: [item("248642"), item("248644"), item("248642")] }]);
    client.createReport.mockResolvedValueOnce({ reportId: "rep-1", reused: false });
    repository.markReportRequested!.mockResolvedValueOnce({});

    expect(await startReportForRequest("g1", client)).toBe(true);
    expect(repository.listRequestsReadyForReport).toHaveBeenCalledWith(1, "g1");
    expect(client.createReport).toHaveBeenCalledWith({
      axCode: "3F6", imcEdition: "04/0",
      selection: { series: "GLB 248", date: "20261117", models: [{ modelDesignation: "248642" }, { modelDesignation: "248644" }] },
    });
    expect(repository.markReportRequested).toHaveBeenCalledWith("g1", "rep-1");
  });

  it("falls back to the date stored when the request was created", async () => {
    repository.listRequestsReadyForReport!.mockResolvedValueOnce([{ request: request(), items: [item("248642", { dataDate: null })] }]);
    client.createReport.mockResolvedValueOnce({ reportId: "rep-1", reused: false });
    await startReportForRequest("g1", client);
    expect(client.createReport.mock.calls[0]![0].selection.date).toBe("20261116");
  });

  it("fails the start, and tells support, when the models disagree on series or date", async () => {
    repository.markReportFailedToStart!.mockResolvedValue({ reportAttempts: 1 });
    repository.listRequestsReadyForReport!.mockResolvedValueOnce([{ request: request(), items: [item("248642"), item("248644", { readerParams: { series: "S-Class 223" } })] }]);
    expect(await startReportForRequest("g1", client)).toBe(false);
    repository.listRequestsReadyForReport!.mockResolvedValueOnce([{ request: request(), items: [item("248642"), item("248644", { dataDate: "20261118" })] }]);
    expect(await startReportForRequest("g1", client)).toBe(false);

    expect(client.createReport).not.toHaveBeenCalled();
    expect(repository.markReportFailedToStart).toHaveBeenCalledTimes(2);
    expect(notifications.notifyReportFailed).toHaveBeenCalledWith("g1", "start-1", expect.stringContaining("serie y la fecha"));
  });

  it("only acts for Mercedes-Benz when its transformer is configured, regardless of BMW's", async () => {
    delete process.env.MERCEDES_TRANSFORMER_BASE_URL;
    process.env.BMW_TRANSFORMER_BASE_URL = "http://localhost:3005";
    expect(await startReportForRequest("g1", client)).toBe(false);
    expect(await startPendingReports(["g1"], client)).toBe(0);
    expect(repository.listRequestsReadyForReport).not.toHaveBeenCalled();
  });

  it("does not call the transformer when another path claimed the request or the report was already recorded", async () => {
    repository.listRequestsReadyForReport!.mockResolvedValue([{ request: request(), items: [item("248642")] }]);
    repository.claimReportStart!.mockResolvedValueOnce(null);
    expect(await startReportForRequest("g1", client)).toBe(false);
    expect(client.createReport).not.toHaveBeenCalled();

    client.createReport.mockResolvedValueOnce({ reportId: "rep-1", reused: true });
    repository.markReportRequested!.mockResolvedValueOnce(null);
    expect(await startReportForRequest("g1", client)).toBe(false);
  });

  it("keeps the request retryable while the transformer is unreachable and gives up after five failures", async () => {
    repository.listRequestsReadyForReport!.mockResolvedValue([{ request: request(), items: [item("248642")] }]);
    client.createReport.mockRejectedValue(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true));
    expect(await startReportForRequest("g1", client)).toBe(false);
    expect(repository.markReportFailedToStart).not.toHaveBeenCalled();

    repository.recordReportStartFailure!.mockResolvedValueOnce(5);
    repository.markReportFailedToStart!.mockResolvedValueOnce({ reportAttempts: 0 });
    expect(await startReportForRequest("g1", client)).toBe(false);
    expect(repository.markReportFailedToStart).toHaveBeenCalledWith("g1", expect.stringContaining("no responde"));
  });

  it("surfaces a rejection by the transformer, such as a model without data (422)", async () => {
    repository.listRequestsReadyForReport!.mockResolvedValueOnce([{ request: request(), items: [item("248642")] }]);
    client.createReport.mockRejectedValueOnce(new ReaderError("Faltan datos extraídos para cargar la solicitud.", "TRANSFORMER_NOT_AVAILABLE", false, 422));
    repository.markReportFailedToStart!.mockResolvedValueOnce({ reportAttempts: 1 });
    await startReportForRequest("g1", client);
    expect(repository.markReportFailedToStart).toHaveBeenCalledWith("g1", "Faltan datos extraídos para cargar la solicitud.");
    expect(notifications.notifyReportFailed).toHaveBeenCalledWith("g1", "start-1", "Faltan datos extraídos para cargar la solicitud.");
  });

  it("sends ready requests when the history asks and when the reconciliation runs", async () => {
    repository.listRequestsReadyForReport!.mockResolvedValue([{ request: request(), items: [item("248642")] }]);
    client.createReport.mockResolvedValue({ reportId: "rep-1", reused: false });
    repository.markReportRequested!.mockResolvedValue({});
    expect(await startPendingReports(["g1"], client)).toBe(1);
    expect(await reconcileTransformer(client, client)).toEqual({ started: 1, updated: 0 });
    expect(repository.listRequestsReadyForLoad).not.toHaveBeenCalled();
  });
});

describe("following the Mercedes-Benz report", () => {
  it("completes it and makes the Excel downloadable", async () => {
    repository.listActiveReports!.mockResolvedValueOnce([running()]);
    client.getReport.mockResolvedValueOnce({ requestId: "rep-1", status: "completed", artifacts: [{ name: "report", primary: true }, { name: "summary" }] });
    expect(await reconcileTransformer(client, client)).toEqual({ started: 0, updated: 1 });
    expect(repository.updateReportState).toHaveBeenCalledWith("g1", "rep-1", { status: "completed", error: expect.any(String), downloadable: true });
    expect(notifications.notifyReportFailed).not.toHaveBeenCalled();
  });

  it("shows the failure with its message, notifies support and keeps the Excel when the transformer stored it", async () => {
    repository.listActiveReports!.mockResolvedValueOnce([running(), running({ requestGroupId: "g2", reportRemoteId: "rep-2" })]);
    client.getReport
      .mockResolvedValueOnce({ requestId: "rep-1", status: "failed", stage: "failed", artifacts: [{ name: "report", primary: true }], error: { code: "INTERNAL_ERROR", message: "SQL Server no disponible" } })
      .mockResolvedValueOnce({ requestId: "rep-2", status: "failed", error: { code: "NOT_AVAILABLE", message: "Falta un fichero del marcador" } });
    await reconcileTransformer(client, client);

    expect(repository.updateReportState).toHaveBeenCalledWith("g1", "rep-1", { status: "failed", error: "SQL Server no disponible", downloadable: true });
    expect(repository.updateReportState).toHaveBeenCalledWith("g2", "rep-2", { status: "failed", error: "Falta un fichero del marcador", downloadable: false });
    expect(notifications.notifyReportFailed).toHaveBeenCalledWith("g1", "rep-1", "SQL Server no disponible");
    expect(notifications.notifyReportFailed).toHaveBeenCalledWith("g2", "rep-2", "Falta un fichero del marcador");
  });

  it("fails the report when the transformer forgot it and ignores transient errors and unchanged states", async () => {
    repository.listActiveReports!.mockResolvedValueOnce([running({ requestGroupId: "a", reportRemoteId: "ra" }), running({ requestGroupId: "b", reportRemoteId: "rb" }), running({ requestGroupId: "c", reportRemoteId: "rc" })]);
    client.getReport
      .mockRejectedValueOnce(new ReaderError("El trabajo del transformer ya no está disponible.", "TRANSFORMER_JOB_NOT_FOUND", false, 404))
      .mockRejectedValueOnce(new ReaderError("down", "TRANSFORMER_UNAVAILABLE", true))
      .mockResolvedValueOnce({ requestId: "rc", status: "running", stage: "building" });
    expect(await reconcileTransformer(client, client)).toEqual({ started: 0, updated: 0 });
    expect(repository.updateReportState).toHaveBeenCalledTimes(1);
    expect(repository.updateReportState).toHaveBeenCalledWith("a", "ra", { status: "failed", error: "El trabajo del transformer ya no está disponible.", downloadable: false });
  });

  it("polls from the history at most once per interval", async () => {
    repository.listRequestsByIds!.mockResolvedValueOnce([running(), request({ requestGroupId: "done", reportStatus: "completed", reportRemoteId: "x" })]);
    repository.claimReportPoll!.mockResolvedValueOnce(running());
    client.getReport.mockResolvedValueOnce({ requestId: "rep-1", status: "completed" });
    expect(await syncTransformerStates(["g1", "done"], client, 5000, client)).toBe(1);
    expect(repository.claimReportPoll).toHaveBeenCalledTimes(1);
    const [, staleBefore] = repository.claimReportPoll!.mock.calls[0] as [string, Date];
    expect(Date.now() - staleBefore.getTime()).toBeGreaterThanOrEqual(4900);

    repository.listRequestsByIds!.mockResolvedValueOnce([running()]);
    repository.claimReportPoll!.mockResolvedValueOnce(null);
    expect(await syncTransformerStates(["g1"], client, 5000, client)).toBe(0);
  });
});

describe("Mercedes-Benz report in the history, download and retry", () => {
  it("describes the report state of a request and marks it applicable only when the Mercedes-Benz transformer is configured", async () => {
    const failed = request({ reportStatus: "failed", reportRemoteId: "rep-1", reportError: "SQL Server no disponible", reportAttempts: 1, reportDownloadable: true, reportCompletedAt: new Date("2026-11-18T10:00:00Z") });
    repository.listRequestsByIds!.mockResolvedValue([failed]);
    repository.getRequestWithRequester!.mockResolvedValue(managed(failed));

    expect((await getTransformerInfo(["g1"], owner)).g1).toMatchObject({
      kind: "mercedes", applicable: true, loadStatus: null,
      report: { status: "failed", error: "SQL Server no disponible", downloadReady: true, canRetry: true, attempts: 1, completedAt: "2026-11-18T10:00:00.000Z" },
    });
    expect(client.getReport).not.toHaveBeenCalled();

    delete process.env.MERCEDES_TRANSFORMER_BASE_URL;
    expect((await getTransformerInfo(["g1"], owner)).g1).toMatchObject({ applicable: false });
  });

  it("looks for a pending report to start while the history is open", async () => {
    const pending = request();
    repository.listRequestsByIds!.mockResolvedValue([pending]);
    repository.getRequestWithRequester!.mockResolvedValue(managed(pending));
    vi.mocked(getTransformerClient).mockReturnValue(client as never);
    await getTransformerInfo(["g1"], owner);
    expect(repository.listRequestsReadyForReport).toHaveBeenCalledWith(1, "g1");
  });

  it("downloads the Excel as {axCode}.xlsx, including from a failed report that kept its file", async () => {
    const file = new Response("xlsx");
    client.downloadReport.mockResolvedValue(file);
    for (const status of ["completed", "failed"]) {
      repository.getRequestWithRequester!.mockResolvedValueOnce(managed(request({ reportStatus: status, reportRemoteId: "rep-1", reportDownloadable: true })));
      expect(await downloadRequestReport("g1", owner, client)).toEqual({ file, filename: "3F6.xlsx" });
    }
    expect(client.downloadReport).toHaveBeenCalledWith("rep-1");
  });

  it("refuses to download when there is no Excel or the actor cannot manage the request", async () => {
    repository.getRequestWithRequester!.mockResolvedValueOnce(managed(running()));
    await expect(downloadRequestReport("g1", owner, client)).rejects.toMatchObject({ status: 409, code: "REPORT_NOT_READY" });
    repository.getRequestWithRequester!.mockResolvedValueOnce(managed(request({ reportDownloadable: true, reportRemoteId: "rep-1" })));
    await expect(downloadRequestReport("g1", { id: "other", oracleEmpId: 2, role: "employee" }, client)).rejects.toMatchObject({ status: 404 });
    expect(client.downloadReport).not.toHaveBeenCalled();
  });

  it("restarts a failed report on retry and rejects retrying anything else", async () => {
    repository.getRequestWithRequester!.mockResolvedValue(managed(request()));
    repository.resetFailedReport!.mockResolvedValueOnce({});
    repository.listRequestsReadyForReport!.mockResolvedValueOnce([{ request: request({ reportAttempts: 1 }), items: [item("248642")] }]);
    vi.mocked(getTransformerClient).mockReturnValue(client as never);
    client.createReport.mockResolvedValueOnce({ reportId: "rep-2", reused: false });
    repository.markReportRequested!.mockResolvedValueOnce({});

    await retryRequestReport("g1", owner);
    expect(getTransformerClient).toHaveBeenCalledWith("mercedes");
    expect(repository.markReportRequested).toHaveBeenCalledWith("g1", "rep-2");

    repository.resetFailedReport!.mockResolvedValueOnce(null);
    await expect(retryRequestReport("g1", owner)).rejects.toMatchObject({ status: 409, code: "REPORT_NOT_RETRYABLE" });
  });
});
