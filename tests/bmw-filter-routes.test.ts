import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getBmwDevelopmentCodes: vi.fn(),
  getBmwTypekeys: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/readers/bmw/client", () => ({
  getBmwDevelopmentCodes: mocks.getBmwDevelopmentCodes,
  getBmwTypekeys: mocks.getBmwTypekeys,
}));

import { GET as getDevelopmentCodes } from "@/app/api/readers/bmw/development-codes/route";
import { GET as getTypekeys } from "@/app/api/readers/bmw/typekeys/route";

describe("BMW dependent filter routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: "user-1" });
  });

  it("returns development codes for the validated brand and series", async () => {
    mocks.getBmwDevelopmentCodes.mockResolvedValueOnce([{ value: "G70", label: "G70" }]);
    const response = await getDevelopmentCodes(new Request("http://localhost/api/readers/bmw/development-codes?brand=BMW&series=7%27"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getBmwDevelopmentCodes).toHaveBeenCalledWith("BMW", "7'");
    expect(await response.json()).toMatchObject({ options: [{ value: "G70" }] });
  });

  it("returns typekeys for the selected development code", async () => {
    mocks.getBmwTypekeys.mockResolvedValueOnce([{ value: "41HZ", label: "41HZ · desde 01/07/2026", validFrom: "01/07/2026" }]);
    const response = await getTypekeys(new Request("http://localhost/api/readers/bmw/typekeys?brand=BMW&series=7%27&developmentCode=G70"));

    expect(response.status).toBe(200);
    expect(mocks.getBmwTypekeys).toHaveBeenCalledWith("BMW", "7'", "G70");
    expect(await response.json()).toMatchObject({ options: [{ value: "41HZ" }] });
  });

  it("rejects an invalid development code before calling the reader", async () => {
    const response = await getTypekeys(new Request("http://localhost/api/readers/bmw/typekeys?brand=BMW&series=7&developmentCode=../G70"));
    expect(response.status).toBe(400);
    expect(mocks.getBmwTypekeys).not.toHaveBeenCalled();
  });
});
