import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  attachReaderRequest: vi.fn(),
  claimReaderProgressPoll: vi.fn(),
  cancelUnsubmittedExtraction: vi.fn(),
  claimExtractionSubmission: vi.fn(),
  getExtractionWithRequester: vi.fn(),
  getOwnedExtraction: vi.fn(),
  getRequestStatus: vi.fn(),
  insertExtractionsWithCapacity: vi.fn(),
  listActiveExtractions: vi.fn(),
  listApprovedRequestExtractions: vi.fn(),
  markSubmissionFailed: vi.fn(),
  markExtractionResumed: vi.fn(),
  recordExtractionAction: vi.fn(),
  updateExtractionState: vi.fn(),
}));
const registry = vi.hoisted(() => ({
  getExtractionReader: vi.fn(),
  mapRenaultReaderStatus: vi.fn((state: { status: string }) => state.status === "completed" ? "completed" : "running"),
}));
const reader = vi.hoisted(() => ({
  prepareSubmission: vi.fn(),
  create: vi.fn(),
  getState: vi.fn(),
  cancel: vi.fn(),
  resume: vi.fn(),
  mapStatus: vi.fn((state: { status: string }): "pending" | "running" | "completed" | "failed" | "cancelled" => state.status === "completed" ? "completed" : state.status === "failed" ? "failed" : state.status === "cancelled" ? "cancelled" : "running"),
  failureMessage: vi.fn(() => "BMW no ha podido completar la extracción."),
}));
const bmwReader = vi.hoisted(() => ({
  getBmwDevelopmentCodes: vi.fn(),
  getBmwTypekeys: vi.fn(),
  getRenaultLabourFamilies: vi.fn(),
}));

vi.mock("@/lib/extractions/repository", () => repository);
vi.mock("@/lib/readers/registry", () => registry);
vi.mock("@/lib/readers/bmw/client", () => bmwReader);
vi.mock("@/lib/readers/renault/client", async () => ({ getRenaultLabourFamilies: bmwReader.getRenaultLabourFamilies }));
const organization = vi.hoisted(() => ({ findCoordinatorUser: vi.fn(), findCoordinatorTeamUserIds: vi.fn(), isUserInCoordinatorTeam: vi.fn() }));
vi.mock("@/lib/employees/org-service", () => organization);
const transformer = vi.hoisted(() => ({ startLoadForRequest: vi.fn(), findTableConflict: vi.fn() }));
const notifications = vi.hoisted(() => ({ notifyExtractionFailures: vi.fn() }));
vi.mock("@/lib/mail/notifications", () => notifications);
vi.mock("@/lib/transformer/service", () => transformer);

import { createExtraction, extractionDto, reconcileActiveExtractions, submitNewApprovedRequest } from "@/lib/extractions/service";

const extraction = {
  id: "e1",
  userId: "u1",
  requestGroupId: "g1",
  readerKey: "renault-labours",
  readerParams: { family: "X98", publishedAfter: "", format: "TM01", language: "en", range: "active" },
  brand: "Renault",
  remoteRequestId: null,
  status: "pending",
  submittedAt: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("reader registry extraction flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.getExtractionReader.mockReturnValue(reader);
    reader.prepareSubmission.mockResolvedValue({ formats: ["TM01"] });
    reader.create.mockResolvedValue({ requestId: "remote-1" });
    reader.getState.mockResolvedValue({ status: "completed" });
    reader.cancel.mockResolvedValue({ requestId: "remote-1", status: "cancelled" });
    reader.resume.mockResolvedValue({ requestId: "remote-1", status: "queued" });
    bmwReader.getBmwDevelopmentCodes.mockResolvedValue([{ value: "G70", label: "G70" }]);
    bmwReader.getBmwTypekeys.mockResolvedValue([{ value: "11EH", label: "11EH · 2,998 l" }]);
    bmwReader.getRenaultLabourFamilies.mockResolvedValue([{ value: "X98", label: "Clio" }]);
    repository.listApprovedRequestExtractions.mockResolvedValue([extraction]);
    repository.claimExtractionSubmission.mockResolvedValue({ ...extraction, submittedAt: new Date("2026-01-02T00:00:00.000Z") });
    repository.attachReaderRequest.mockResolvedValue({ ...extraction, status: "running", remoteRequestId: "remote-1" });
    repository.claimReaderProgressPoll.mockImplementation(async (id: string) => ({ ...extraction, id, status: "running", remoteRequestId: "remote-1", progress: 0, readerStatus: "queued" }));
    repository.markSubmissionFailed.mockResolvedValue({ ...extraction, status: "failed" });
    repository.listActiveExtractions.mockResolvedValue([]);
    repository.updateExtractionState.mockImplementation(async (_id, update) => ({ ...extraction, ...update }));
    repository.getExtractionWithRequester.mockResolvedValue(null);
    repository.cancelUnsubmittedExtraction.mockResolvedValue({ ...extraction, status: "cancelled" });
    repository.markExtractionResumed.mockResolvedValue({ ...extraction, status: "running" });
    repository.recordExtractionAction.mockResolvedValue({ id: "audit-1" });
    organization.findCoordinatorTeamUserIds.mockResolvedValue([]);
    organization.isUserInCoordinatorTeam.mockResolvedValue(false);
  });

  it("does not submit when another worker already claimed the pending row", async () => {
    repository.claimExtractionSubmission.mockResolvedValueOnce(null);
    await submitNewApprovedRequest("g1");
    expect(repository.claimExtractionSubmission).toHaveBeenCalledWith("e1");
    expect(reader.create).not.toHaveBeenCalled();
  });

  it("routes BMW requests through the registered adapter and persists its remote ID", async () => {
    const bmw = {
      ...extraction,
      readerKey: "bmw-labours",
      brand: "MINI",
      readerParams: { series: "F56", developmentCode: "F56", typekey: "11EH", language: "en-GB", developmentStart: "2026-01-01" },
    };
    repository.listApprovedRequestExtractions.mockResolvedValueOnce([bmw]);
    repository.claimExtractionSubmission.mockResolvedValueOnce({ ...bmw, submittedAt: new Date("2026-01-02T00:00:00.000Z") });

    await submitNewApprovedRequest("g1");

    expect(registry.getExtractionReader).toHaveBeenCalledWith("bmw-labours");
    expect(reader.prepareSubmission).toHaveBeenCalledOnce();
    expect(reader.create).toHaveBeenCalledWith(expect.objectContaining({ readerKey: "bmw-labours", brand: "MINI" }), { formats: ["TM01"] });
    expect(repository.attachReaderRequest).toHaveBeenCalledWith("e1", "remote-1", expect.any(Date), { progress: 0, readerStatus: "queued" });
  });

  it("keeps transient submit errors retryable by the reconcile job", async () => {
    const claim = { ...extraction, submittedAt: new Date("2026-01-02T00:00:00.000Z") };
    repository.claimExtractionSubmission.mockResolvedValueOnce(claim);
    reader.create.mockRejectedValueOnce(new Error("upstream failure"));

    await submitNewApprovedRequest("g1");

    expect(repository.markSubmissionFailed).toHaveBeenCalledWith("e1", claim.submittedAt, {
      errorCode: "INTERNAL_ERROR",
      errorMessage: "No se ha podido iniciar la extracción.",
    });
  });

  it("synchronizes BMW status using the reader registered on the extraction", async () => {
    const bmw = { ...extraction, readerKey: "bmw-labours", status: "running", remoteRequestId: "remote-1" };
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "rate_limited", progress: 42, error: null });
    reader.mapStatus.mockReturnValueOnce("running");

    await reconcileActiveExtractions();

    expect(registry.getExtractionReader).toHaveBeenCalledWith("bmw-labours");
    expect(reader.getState).toHaveBeenCalledWith("remote-1");
    expect(repository.updateExtractionState).toHaveBeenCalledWith("e1", { status: "running", errorCode: null, errorMessage: null, progress: 42, readerStatus: "rate_limited", readerStalled: false });
  });

  it("starts the BMW_Labour load as soon as a typekey completes, and only then", async () => {
    transformer.startLoadForRequest.mockResolvedValue(true);
    repository.updateExtractionState.mockResolvedValue({ ...extraction, status: "completed" });
    const bmw = { ...extraction, readerKey: "bmw-labours", status: "running", remoteRequestId: "remote-1" };
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "completed", progress: 100, error: null });
    reader.mapStatus.mockReturnValueOnce("completed");

    await reconcileActiveExtractions();
    expect(transformer.startLoadForRequest).toHaveBeenCalledTimes(1);
    expect(transformer.startLoadForRequest).toHaveBeenCalledWith("g1");

    transformer.startLoadForRequest.mockClear();
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "running", progress: 40, error: null });
    reader.mapStatus.mockReturnValueOnce("running");
    await reconcileActiveExtractions();
    expect(transformer.startLoadForRequest).not.toHaveBeenCalled();
  });

  it("asks for the failure email when a typekey fails and not when it is still running", async () => {
    repository.updateExtractionState.mockResolvedValue({ ...extraction, status: "failed" });
    const bmw = { ...extraction, readerKey: "bmw-labours", status: "running", remoteRequestId: "remote-1" };
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "failed", error: { message: "x" } });
    reader.mapStatus.mockReturnValueOnce("failed");
    await reconcileActiveExtractions();
    expect(notifications.notifyExtractionFailures).toHaveBeenCalledWith("g1");

    notifications.notifyExtractionFailures.mockClear();
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "running", progress: 10, error: null });
    reader.mapStatus.mockReturnValueOnce("running");
    await reconcileActiveExtractions();
    expect(notifications.notifyExtractionFailures).not.toHaveBeenCalled();
  });

  it("keeps the extraction completed when the transformer cannot be reached", async () => {
    transformer.startLoadForRequest.mockRejectedValueOnce(new Error("transformer down"));
    repository.updateExtractionState.mockResolvedValue({ ...extraction, status: "completed" });
    const bmw = { ...extraction, readerKey: "bmw-labours", status: "running", remoteRequestId: "remote-1" };
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "completed", progress: 100, error: null });
    reader.mapStatus.mockReturnValueOnce("completed");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(reconcileActiveExtractions()).resolves.toBe(1);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("polls live progress only for BMW rows and leaves Renault on the scheduled reconciliation", async () => {
    const bmw = { ...extraction, readerKey: "bmw-labours", status: "running", remoteRequestId: "bmw-remote" } as never;
    const renault = { ...extraction, id: "e2", status: "running", remoteRequestId: "renault-remote" } as never;
    reader.getState.mockResolvedValueOnce({ status: "running", progress: 45, error: null });

    const rows = await import("@/lib/extractions/service").then(({ syncLiveReaderProgress }) => syncLiveReaderProgress([
      { extraction: bmw, requestStatus: "approved" },
      { extraction: renault, requestStatus: "approved" },
    ]));

    expect(repository.claimReaderProgressPoll).toHaveBeenCalledWith("e1", expect.any(Date));
    expect(reader.getState).toHaveBeenCalledTimes(1);
    expect(rows[0]?.extraction).toMatchObject({ progress: 45, readerStatus: "running" });
    expect(rows[1]).toMatchObject({ extraction: { id: "e2" } });
  });

  it("polls an already-submitted BMW request while its reader status maps to pending", async () => {
    const bmw = { ...extraction, readerKey: "bmw-labours", status: "pending", remoteRequestId: "remote-1" };
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "queued", error: null });
    reader.mapStatus.mockReturnValueOnce("pending");

    await reconcileActiveExtractions();

    expect(reader.getState).toHaveBeenCalledWith("remote-1");
    expect(reader.create).not.toHaveBeenCalled();
    expect(repository.updateExtractionState).toHaveBeenCalledWith("e1", { status: "pending", errorCode: null, errorMessage: null, progress: 0, readerStatus: "queued", readerStalled: false });
  });

  it("stores an error code when BMW reports a cancelled request", async () => {
    const bmw = { ...extraction, readerKey: "bmw-labours", status: "running", remoteRequestId: "remote-1" };
    repository.listActiveExtractions.mockResolvedValueOnce([bmw]);
    reader.getState.mockResolvedValueOnce({ status: "cancelled", error: null });
    reader.mapStatus.mockReturnValueOnce("cancelled");

    await reconcileActiveExtractions();

    expect(repository.updateExtractionState).toHaveBeenCalledWith("e1", {
      status: "cancelled",
      errorCode: null,
      errorMessage: null,
      progress: 0,
      readerStatus: "cancelled",
      readerStalled: false,
    });
  });

  it("exposes the completed BMW archive and Renault ZIP downloads", () => {
    expect(extractionDto({ ...extraction, readerKey: "bmw-labours", status: "completed" } as never).downloadReady).toBe(true);
    expect(extractionDto({ ...extraction, readerKey: "renault-labours", status: "completed" } as never).downloadReady).toBe(true);
  });

  it("lets users cancel Renault rows that have not been submitted to a reader", () => {
    const row = extractionDto({ ...extraction, readerKey: "renault-labours", status: "pending", remoteRequestId: null, submittedAt: null } as never);
    expect(row.canCancel).toBe(true);
  });

  it("limits extraction management to the requester, their coordinator, or an admin", async () => {
    const { getManageableExtraction } = await import("@/lib/extractions/service");
    const row = { extraction: { ...extraction, userId: "employee-1" }, requestStatus: "approved", requester: { id: "employee-1", oracleEmpId: 321, fallbackName: null, fallbackEmail: null } };
    repository.getExtractionWithRequester.mockResolvedValue(row);

    await expect(getManageableExtraction("e1", { id: "employee-1", oracleEmpId: 321, role: "employee" })).resolves.toEqual(row);
    await expect(getManageableExtraction("e1", { id: "other-employee", oracleEmpId: 654, role: "employee" })).resolves.toBeNull();

    organization.isUserInCoordinatorTeam.mockResolvedValueOnce(true);
    await expect(getManageableExtraction("e1", { id: "coordinator-1", oracleEmpId: 123, role: "coordinator" })).resolves.toEqual(row);
    await expect(getManageableExtraction("e1", { id: "admin-1", oracleEmpId: null, role: "admin" })).resolves.toEqual(row);
  });

  it("cancels an unsubmitted request locally and calls the reader for submitted BMW jobs", async () => {
    const { performExtractionAction } = await import("@/lib/extractions/service");
    const actor = { id: "employee-1", oracleEmpId: 321, role: "employee" as const };
    repository.getExtractionWithRequester.mockResolvedValueOnce({ extraction: { ...extraction, userId: actor.id }, requestStatus: "approved", requester: { id: actor.id, oracleEmpId: 321 } });
    await expect(performExtractionAction("e1", "cancel", actor)).resolves.toMatchObject({ status: "cancelled" });
    expect(repository.cancelUnsubmittedExtraction).toHaveBeenCalledWith("e1");

    repository.getExtractionWithRequester.mockResolvedValueOnce({ extraction: { ...extraction, userId: actor.id, readerKey: "bmw-labours", status: "running", remoteRequestId: "remote-1" }, requestStatus: "approved", requester: { id: actor.id, oracleEmpId: 321 } });
    await expect(performExtractionAction("e1", "cancel", actor)).resolves.toMatchObject({ status: "cancelled" });
    expect(reader.cancel).toHaveBeenCalledWith("remote-1");
    expect(repository.recordExtractionAction).toHaveBeenNthCalledWith(1, { extractionId: "e1", actorId: actor.id, action: "cancel", outcome: "succeeded", readerStatus: "cancelled" });
  });

  it("rejects force resume unless the reader confirms a stalled request", async () => {
    const { performExtractionAction } = await import("@/lib/extractions/service");
    const actor = { id: "employee-1", oracleEmpId: 321, role: "employee" as const };
    repository.getExtractionWithRequester.mockResolvedValueOnce({ extraction: { ...extraction, userId: actor.id, readerKey: "bmw-labours", status: "running", remoteRequestId: "remote-1" }, requestStatus: "approved", requester: { id: actor.id, oracleEmpId: 321 } });
    reader.getState.mockResolvedValueOnce({ status: "running", readerStalled: false });

    await expect(performExtractionAction("e1", "resume", actor, true)).rejects.toMatchObject({ code: "FORCE_RESUME_NOT_ALLOWED" });
    expect(reader.resume).not.toHaveBeenCalled();
    expect(repository.recordExtractionAction).toHaveBeenCalledWith({ extractionId: "e1", actorId: actor.id, action: "force_resume", outcome: "failed", readerStatus: "FORCE_RESUME_NOT_ALLOWED" });
  });

  it("returns a sanitized reader stage and typekey progress only after checking access", async () => {
    const { getExtractionReaderDetail } = await import("@/lib/extractions/service");
    const actor = { id: "employee-1", oracleEmpId: 321, role: "employee" as const };
    repository.getExtractionWithRequester.mockResolvedValueOnce({ extraction: { ...extraction, userId: actor.id, readerKey: "bmw-labours", remoteRequestId: "remote-1", progress: 75 }, requestStatus: "approved", requester: { id: actor.id, oracleEmpId: 321 } });
    reader.getState.mockResolvedValueOnce({ status: "running", stage: "41HZ:catalog", progress: 75, details: { stalled: false, typekeys: [{ typekey: "41HZ", series: "X", family: "G05", completedAwSheetOIDs: 28, awSheetOIDs: 50, remainingAwSheetOIDs: 22, failedOids: 0, hgs: 3 }], worker: { alive: true, secret: "do-not-return" } } });

    await expect(getExtractionReaderDetail("e1", actor)).resolves.toEqual({
      status: "running",
      stage: "41HZ:catalog",
      progress: 75,
      stalled: false,
      typekeys: [{ typekey: "41HZ", series: "X", family: "G05", completed: 28, total: 50, remaining: 22, failed: 0, groups: 3 }],
    });
  });

  it("revalidates selected BMW codes and returned typekeys before saving", async () => {
    repository.insertExtractionsWithCapacity.mockResolvedValueOnce([{ requestGroupId: "g-bmw" }]);
    const input = {
      axCode: "AX12",
      imcEdition: "05/0",
      completion: "2026-10-20",
      comments: "",
      laboursDevelopmentStart: "2026-03-01",
      vehicles: [{ manufacturerGroup: "BMW" as const, brand: "BMW" as const, series: "7'", developmentCode: "G70", typekey: "11EH", modelDescription: "" }],
    };

    await expect(createExtraction({ id: "user-1", oracleEmpId: null }, input, "admin")).resolves.toMatchObject({ requestGroupId: "g-bmw" });

    expect(bmwReader.getBmwDevelopmentCodes).toHaveBeenCalledWith("BMW", "7'");
    expect(bmwReader.getBmwTypekeys).toHaveBeenCalledWith("BMW", "7'", "G70");
    expect(repository.insertExtractionsWithCapacity).toHaveBeenCalledWith("user-1", input, 50, { status: "approved", coordinatorId: null });
  });

  it("asks for confirmation before replacing a table that is already loaded for the same AX code, edition and brand", async () => {
    const input = {
      axCode: "AX12", imcEdition: "05/0", completion: "2026-10-20", comments: "", laboursDevelopmentStart: "2026-03-01",
      vehicles: [{ manufacturerGroup: "BMW" as const, brand: "MINI" as const, series: "F56", developmentCode: "F56", typekey: "11EH", modelDescription: "" }],
    };
    bmwReader.getBmwDevelopmentCodes.mockResolvedValue([{ value: "F56", label: "F56" }]);
    bmwReader.getBmwTypekeys.mockResolvedValue([{ value: "11EH", label: "11EH" }]);
    transformer.findTableConflict.mockResolvedValue({ loadedAt: "2026-10-26T14:21:00.000Z", loadStatus: "completed" });

    await expect(createExtraction({ id: "user-1", oracleEmpId: null }, input, "admin")).rejects.toMatchObject({ code: "TABLE_REPLACE_NOT_CONFIRMED", status: 409 });
    expect(transformer.findTableConflict).toHaveBeenCalledWith({ axCode: "AX12", imcEdition: "05/0", brand: "MINI" });
    expect(repository.insertExtractionsWithCapacity).not.toHaveBeenCalled();

    repository.insertExtractionsWithCapacity.mockResolvedValueOnce([{ requestGroupId: "g-confirmed" }]);
    await expect(createExtraction({ id: "user-1", oracleEmpId: null }, input, "admin", { confirmReplace: true })).resolves.toMatchObject({ requestGroupId: "g-confirmed" });

    transformer.findTableConflict.mockResolvedValue(null);
    repository.insertExtractionsWithCapacity.mockResolvedValueOnce([{ requestGroupId: "g-free" }]);
    await expect(createExtraction({ id: "user-1", oracleEmpId: null }, input, "admin")).resolves.toMatchObject({ requestGroupId: "g-free" });
    transformer.findTableConflict.mockReset();
  });

  it("revalidates every Renault family with the reader before persisting a multi-family request", async () => {
    repository.insertExtractionsWithCapacity.mockResolvedValueOnce([{ requestGroupId: "g-renault" }]);
    bmwReader.getRenaultLabourFamilies.mockResolvedValueOnce([{ value: "B52", label: "Sandero" }, { value: "HJD", label: "Duster" }]);
    const input = {
      axCode: "AX45",
      imcEdition: "05/0",
      completion: "2026-10-20",
      comments: "",
      laboursDevelopmentStart: "2026-03-01",
      vehicles: [
        { manufacturerGroup: "Renault" as const, brand: "Dacia" as const, modelDescription: "Sandero", modelCode: "B52" },
        { manufacturerGroup: "Renault" as const, brand: "Dacia" as const, modelDescription: "Duster", modelCode: "HJD" },
      ],
    };

    await expect(createExtraction({ id: "user-1", oracleEmpId: null }, input, "admin")).resolves.toMatchObject({ requestGroupId: "g-renault" });
    expect(bmwReader.getRenaultLabourFamilies).toHaveBeenCalledWith("Dacia");
    expect(repository.insertExtractionsWithCapacity).toHaveBeenCalledWith("user-1", input, 50, { status: "approved", coordinatorId: null });
  });

  it("rejects a Renault family that the reader no longer returns", async () => {
    bmwReader.getRenaultLabourFamilies.mockResolvedValueOnce([]);
    const input = {
      axCode: "AX45",
      imcEdition: "05/0",
      completion: "2026-10-20",
      comments: "",
      laboursDevelopmentStart: "2026-03-01",
      vehicles: [{ manufacturerGroup: "Renault" as const, brand: "Renault" as const, modelDescription: "Clio", modelCode: "X98" }],
    };

    await expect(createExtraction({ id: "user-1", oracleEmpId: null }, input, "admin")).rejects.toMatchObject({ code: "INVALID_RENAULT_SELECTION" });
    expect(repository.insertExtractionsWithCapacity).not.toHaveBeenCalled();
  });

  it("rejects a typekey that BMW did not return before persisting the request", async () => {
    bmwReader.getBmwTypekeys.mockResolvedValueOnce([]);
    const input = {
      axCode: "AX12",
      imcEdition: "05/0",
      completion: "2026-10-20",
      comments: "",
      laboursDevelopmentStart: "2026-03-01",
      vehicles: [{ manufacturerGroup: "BMW" as const, brand: "BMW" as const, series: "7'", developmentCode: "G70", typekey: "11EH", modelDescription: "" }],
    };

    await expect(createExtraction({ id: "user-1", oracleEmpId: null }, input, "admin")).rejects.toMatchObject({ code: "INVALID_BMW_SELECTION" });
    expect(repository.insertExtractionsWithCapacity).not.toHaveBeenCalled();
  });
});
