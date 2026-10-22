import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getBmwModelSeries: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/readers/bmw/client", () => ({ getBmwModelSeries: mocks.getBmwModelSeries }));

import { GET } from "@/app/api/readers/bmw/series/route";

describe("GET /api/readers/bmw/series", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a signed-in user and validates the fixed brand list", async () => {
    mocks.requireApiUser.mockResolvedValueOnce(null);
    const unauthenticated = await GET(new Request("http://localhost/api/readers/bmw/series?brand=BMW"));
    expect(unauthenticated.status).toBe(401);

    mocks.requireApiUser.mockResolvedValueOnce({ id: "user-1" });
    const invalid = await GET(new Request("http://localhost/api/readers/bmw/series?brand=BMW%20i"));
    expect(invalid.status).toBe(400);
    expect(mocks.getBmwModelSeries).not.toHaveBeenCalled();
  });

  it("returns the cached reader series with private no-store headers", async () => {
    mocks.requireApiUser.mockResolvedValueOnce({ id: "user-1" });
    mocks.getBmwModelSeries.mockResolvedValueOnce([{ value: "7", label: "7 Series" }]);

    const response = await GET(new Request("http://localhost/api/readers/bmw/series?brand=BMW"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ options: [{ value: "7", label: "7 Series" }] });
    expect(mocks.getBmwModelSeries).toHaveBeenCalledWith("BMW");
  });
});
