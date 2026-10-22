import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => Object.fromEntries([
  "attachReaderRequest", "getOwnedExtraction", "claimExtractionSubmission", "insertExtractionsWithCapacity", "listActiveExtractions", "getRequestStatus",
  "listApprovedRequestExtractions", "markSubmissionFailed", "claimReaderProgressPoll", "updateExtractionState", "getExtractionWithRequester", "listRequestExtractions",
  "listVisibleExtractions", "listVisibleExtractionsByIds", "cancelUnsubmittedExtraction", "markExtractionResumed", "recordExtractionAction",
].map((name) => [name, vi.fn()])));
const organization = vi.hoisted(() => ({ findCoordinatorUser: vi.fn(), findCoordinatorTeamUserIds: vi.fn(), isUserInCoordinatorTeam: vi.fn() }));

vi.mock("@/lib/extractions/repository", () => repository);
vi.mock("@/lib/readers/registry", () => ({ getExtractionReader: vi.fn(), getExtractionReaderCapabilities: vi.fn(), mapRenaultReaderStatus: vi.fn() }));
vi.mock("@/lib/readers/bmw/client", () => ({ getBmwDevelopmentCodes: vi.fn(), getBmwTypekeys: vi.fn() }));
vi.mock("@/lib/readers/renault/client", () => ({ getRenaultLabourFamilies: vi.fn() }));
vi.mock("@/lib/employees/org-service", () => organization);

import { getRepeatableRequestItems } from "@/lib/extractions/service";

const requester = { id: "owner", oracleEmpId: 1, fallbackName: null, fallbackEmail: null };
const row = (id: string, status: string, requestStatus = "approved", userId = "owner") => ({ extraction: { id, status, userId }, requestStatus, requester });

describe("getRepeatableRequestItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organization.isUserInCoordinatorTeam.mockResolvedValue(false);
  });

  it("returns only the failed or cancelled items of a request the actor owns", async () => {
    repository.listRequestExtractions.mockResolvedValueOnce([row("a", "completed"), row("b", "failed"), row("c", "cancelled"), row("d", "running")]);
    const items = await getRepeatableRequestItems("g1", { id: "owner", oracleEmpId: 1, role: "employee" });
    expect(items?.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("returns null when nothing can be repeated, the request awaits approval or the actor cannot manage it", async () => {
    const actor = { id: "owner", oracleEmpId: 1, role: "employee" as const };
    repository.listRequestExtractions.mockResolvedValueOnce([row("a", "completed")]);
    expect(await getRepeatableRequestItems("g1", actor)).toBeNull();
    repository.listRequestExtractions.mockResolvedValueOnce([row("a", "failed", "pending")]);
    expect(await getRepeatableRequestItems("g1", actor)).toBeNull();
    repository.listRequestExtractions.mockResolvedValueOnce([row("a", "failed")]);
    expect(await getRepeatableRequestItems("g1", { id: "other", oracleEmpId: 2, role: "employee" })).toBeNull();
    repository.listRequestExtractions.mockResolvedValueOnce([]);
    expect(await getRepeatableRequestItems("g1", actor)).toBeNull();
  });

  it("lets admins and coordinators of the requester's team repeat it", async () => {
    repository.listRequestExtractions.mockResolvedValue([row("b", "failed")]);
    expect(await getRepeatableRequestItems("g1", { id: "admin", oracleEmpId: 9, role: "admin" })).toHaveLength(1);
    organization.isUserInCoordinatorTeam.mockResolvedValueOnce(true);
    expect(await getRepeatableRequestItems("g1", { id: "coord", oracleEmpId: 8, role: "coordinator" })).toHaveLength(1);
  });
});
