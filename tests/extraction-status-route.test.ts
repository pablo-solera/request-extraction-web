import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiIdentity, listExtractionsVisibleToUserByIds, getReaderCapabilitiesForExtractions, syncLiveReaderProgress } = vi.hoisted(() => ({
  requireApiIdentity: vi.fn(),
  listExtractionsVisibleToUserByIds: vi.fn(),
  getReaderCapabilitiesForExtractions: vi.fn(async () => new Map()),
  syncLiveReaderProgress: vi.fn(async (rows: unknown[]) => rows),
}));

vi.mock("@/lib/auth/guards", () => ({ requireApiIdentity }));
vi.mock("@/lib/extractions/service", () => ({
  extractionDto: (extraction: { id: string; progress?: number | null; readerStatus?: string | null }, requestStatus: string, requesterName?: string | null) => ({ id: extraction.id, requestStatus, progress: extraction.progress, readerStatus: extraction.readerStatus, requesterName: requesterName ?? null }),
  listExtractionsVisibleToUserByIds,
  getReaderCapabilitiesForExtractions,
  syncLiveReaderProgress,
}));

import { GET } from "@/app/api/extractions/status/route";

describe("GET /api/extractions/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an authenticated user", async () => {
    requireApiIdentity.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/extractions/status"));
    expect(response.status).toBe(401);
    expect(listExtractionsVisibleToUserByIds).not.toHaveBeenCalled();
  });

  it("validates ids and returns only owner-scoped rows", async () => {
    const user = { id: "user-1", oracleEmpId: null, role: "employee" as const };
    requireApiIdentity.mockResolvedValueOnce(user);
    listExtractionsVisibleToUserByIds.mockResolvedValueOnce([{ extraction: { id: "550e8400-e29b-41d4-a716-446655440000" }, requestStatus: "pending", requester: { fallbackName: null, fallbackEmail: null } }]);
    const response = await GET(new Request("http://localhost/api/extractions/status?id=550e8400-e29b-41d4-a716-446655440000"));
    expect(response.status).toBe(200);
    expect(listExtractionsVisibleToUserByIds).toHaveBeenCalledWith(user, ["550e8400-e29b-41d4-a716-446655440000"]);
    expect(syncLiveReaderProgress).toHaveBeenCalledWith([{ extraction: { id: "550e8400-e29b-41d4-a716-446655440000" }, requestStatus: "pending", requester: { fallbackName: null, fallbackEmail: null } }]);
    expect(await response.json()).toEqual([{ id: "550e8400-e29b-41d4-a716-446655440000", requestStatus: "pending", requesterName: null }]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns fresh progress fields after synchronizing the user's active BMW rows", async () => {
    const ownedRow = { extraction: { id: "e-bmw", progress: 20, readerStatus: "running" }, requestStatus: "approved" };
    const user = { id: "user-1", oracleEmpId: null, role: "employee" as const };
    requireApiIdentity.mockResolvedValueOnce(user);
    listExtractionsVisibleToUserByIds.mockResolvedValueOnce([{ ...ownedRow, requester: { fallbackName: "Técnico", fallbackEmail: null } }]);
    syncLiveReaderProgress.mockResolvedValueOnce([{ extraction: { id: "e-bmw", progress: 45, readerStatus: "rate_limited" }, requestStatus: "approved", requester: { fallbackName: "Técnico", fallbackEmail: null } }]);

    const response = await GET(new Request("http://localhost/api/extractions/status?id=550e8400-e29b-41d4-a716-446655440000"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "e-bmw", requestStatus: "approved", progress: 45, readerStatus: "rate_limited", requesterName: "Técnico" }]);
  });

  it("rejects invalid or excessive ids", async () => {
    requireApiIdentity.mockResolvedValueOnce({ id: "user-1", oracleEmpId: null, role: "employee" });
    const response = await GET(new Request("http://localhost/api/extractions/status?id=not-a-uuid"));
    expect(response.status).toBe(400);
    expect(listExtractionsVisibleToUserByIds).not.toHaveBeenCalled();
  });
});
