import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiIdentity: vi.fn(),
  getManageableExtraction: vi.fn(),
  downloadBmwLabourArchive: vi.fn(),
  getRenaultDownloadLocation: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireApiIdentity: mocks.requireApiIdentity }));
vi.mock("@/lib/extractions/service", () => ({ getManageableExtraction: mocks.getManageableExtraction }));
vi.mock("@/lib/readers/bmw/client", () => ({ downloadBmwLabourArchive: mocks.downloadBmwLabourArchive }));
vi.mock("@/lib/readers/renault/client", () => ({ getRenaultDownloadLocation: mocks.getRenaultDownloadLocation }));

import { GET } from "@/app/api/extractions/[id]/download/route";

describe("GET /api/extractions/[id]/download", () => {
  beforeEach(() => vi.clearAllMocks());

  it("streams the completed BMW archive only for an authorized user", async () => {
    mocks.requireApiIdentity.mockResolvedValueOnce({ id: "user-1", oracleEmpId: null, role: "employee" });
    mocks.getManageableExtraction.mockResolvedValueOnce({ extraction: { id: "550e8400-e29b-41d4-a716-446655440000", readerKey: "bmw-labours", status: "completed", remoteRequestId: "bmw-request", axCode: "AX_123" } });
    mocks.downloadBmwLabourArchive.mockResolvedValueOnce(new Response("zip-bytes", { headers: { "content-type": "application/zip", "content-length": "9" } }));

    const response = await GET(new Request("http://localhost/api/extractions/550e8400-e29b-41d4-a716-446655440000/download"), { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("AX_123_BMW.zip");
    expect(await response.text()).toBe("zip-bytes");
    expect(mocks.downloadBmwLabourArchive).toHaveBeenCalledWith("bmw-request");
    expect(mocks.getRenaultDownloadLocation).not.toHaveBeenCalled();
  });

  it("returns not found when the user cannot access an extraction", async () => {
    mocks.requireApiIdentity.mockResolvedValueOnce({ id: "user-1", oracleEmpId: null, role: "employee" });
    mocks.getManageableExtraction.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/extractions/550e8400-e29b-41d4-a716-446655440000/download"), { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }) });
    expect(response.status).toBe(404);
    expect(mocks.downloadBmwLabourArchive).not.toHaveBeenCalled();
  });
});
