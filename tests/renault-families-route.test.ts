import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireApiUser: vi.fn(), getRenaultLabourFamilies: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/readers/renault/client", () => ({ getRenaultLabourFamilies: mocks.getRenaultLabourFamilies }));

import { GET } from "@/app/api/readers/renault/families/route";

describe("GET /api/readers/renault/families", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: "user-1" });
  });

  it("returns reader families for the selected Renault-group brand", async () => {
    mocks.getRenaultLabourFamilies.mockResolvedValueOnce([{ value: "B52", label: "Sandero" }]);
    const response = await GET(new Request("http://localhost/api/readers/renault/families?brand=Dacia"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getRenaultLabourFamilies).toHaveBeenCalledWith("Dacia");
    expect(await response.json()).toEqual({ options: [{ value: "B52", label: "Sandero" }] });
  });

  it("requires authentication and rejects unsupported brands before querying the reader", async () => {
    mocks.requireApiUser.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/readers/renault/families?brand=Dacia"))).status).toBe(401);

    const invalid = await GET(new Request("http://localhost/api/readers/renault/families?brand=CUPRA"));
    expect(invalid.status).toBe(400);
    expect(mocks.getRenaultLabourFamilies).not.toHaveBeenCalled();
  });
});
