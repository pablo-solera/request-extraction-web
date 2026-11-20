import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listExtractionsVisibleToUser: vi.fn(),
  getReaderCapabilitiesForExtractions: vi.fn(),
  extractionDto: vi.fn(),
  resolveUserIdentities: vi.fn(),
  getTransformerInfo: vi.fn(),
}));

vi.mock("@/lib/extractions/service", () => ({
  listExtractionsVisibleToUser: mocks.listExtractionsVisibleToUser,
  getReaderCapabilitiesForExtractions: mocks.getReaderCapabilitiesForExtractions,
  extractionDto: mocks.extractionDto,
}));
vi.mock("@/lib/employees/identity-service", () => ({ resolveUserIdentities: mocks.resolveUserIdentities }));
vi.mock("@/lib/transformer/service", () => ({ getTransformerInfo: mocks.getTransformerInfo }));

import { historyPageInputSchema, loadHistoryPage } from "@/lib/extractions/history";

const user = { id: "u1", oracleEmpId: 1, role: "employee" as const };
const requester = { id: "u1", oracleEmpId: 1, fallbackName: "Ana", fallbackEmail: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getReaderCapabilitiesForExtractions.mockResolvedValue(new Map());
  mocks.resolveUserIdentities.mockResolvedValue(new Map());
  mocks.getTransformerInfo.mockResolvedValue({});
  mocks.extractionDto.mockImplementation((extraction: { id: string }) => ({ id: extraction.id }));
});

describe("loadHistoryPage", () => {
  it("forwards the cursor and the AX search to the repository and returns the next cursor", async () => {
    const cursor = { createdAt: "2026-10-20 12:00:00+00", requestGroupId: "550e8400-e29b-41d4-a716-446655440000" };
    const nextCursor = { createdAt: "2026-10-19 12:00:00+00", requestGroupId: "550e8400-e29b-41d4-a716-446655440001" };
    mocks.listExtractionsVisibleToUser.mockResolvedValue({ rows: [{ extraction: { id: "e1", requestGroupId: "g1", readerKey: "bmw-labours" }, requestStatus: "approved", requester }], nextCursor });

    const page = await loadHistoryPage(user, { cursor, query: "1XF" });

    expect(mocks.listExtractionsVisibleToUser).toHaveBeenCalledWith(user, { cursor, axCode: "1XF", requestGroupId: undefined });
    expect(mocks.getTransformerInfo).toHaveBeenCalledWith(["g1"], user);
    expect(page).toEqual({ items: [{ id: "e1" }], transformer: {}, nextCursor });
  });

  it("keeps the page when the transformer lookup fails", async () => {
    mocks.listExtractionsVisibleToUser.mockResolvedValue({ rows: [{ extraction: { id: "e1", requestGroupId: "g1", readerKey: "k" }, requestStatus: "approved", requester }], nextCursor: null });
    mocks.getTransformerInfo.mockRejectedValue(new Error("down"));

    await expect(loadHistoryPage(user)).resolves.toMatchObject({ items: [{ id: "e1" }], transformer: {}, nextCursor: null });
  });
});

describe("historyPageInputSchema", () => {
  it("trims the search and rejects oversized input", () => {
    expect(historyPageInputSchema.parse({ query: "  1XF " }).query).toBe("1XF");
    expect(historyPageInputSchema.safeParse({ query: "x".repeat(41) }).success).toBe(false);
  });
});
