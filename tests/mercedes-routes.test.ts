import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderError } from "@/lib/readers/errors";

const mocks = vi.hoisted(() => ({ requireApiUser: vi.fn(), getMercedesSeries: vi.fn(), getMercedesModels: vi.fn() }));

vi.mock("@/lib/auth/guards", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/readers/mercedes/client", () => ({ getMercedesSeries: mocks.getMercedesSeries, getMercedesModels: mocks.getMercedesModels }));

import { GET as getSeries } from "@/app/api/readers/mercedes/series/route";
import { GET as getModels } from "@/app/api/readers/mercedes/models/route";

describe("Mercedes-Benz option routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("require a signed-in user", async () => {
    mocks.requireApiUser.mockResolvedValue(null);
    expect((await getSeries()).status).toBe(401);
    expect((await getModels(new Request("http://localhost/api/readers/mercedes/models?series=S"))).status).toBe(401);
    expect(mocks.getMercedesSeries).not.toHaveBeenCalled();
  });

  it("returns the series with private no-store headers and maps reader errors", async () => {
    mocks.requireApiUser.mockResolvedValue({ id: "user-1" });
    mocks.getMercedesSeries.mockResolvedValueOnce([{ value: "GLB 248", label: "GLB 248" }]);
    const ok = await getSeries();
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(await ok.json()).toEqual({ options: [{ value: "GLB 248", label: "GLB 248" }] });

    mocks.getMercedesSeries.mockRejectedValueOnce(new ReaderError("El servicio de Mercedes-Benz no está disponible.", "READER_UNAVAILABLE", true));
    const failed = await getSeries();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: { message: "El servicio de Mercedes-Benz no está disponible." } });
  });

  it("validates the series and forwards the product group", async () => {
    mocks.requireApiUser.mockResolvedValue({ id: "user-1" });
    expect((await getModels(new Request("http://localhost/api/readers/mercedes/models"))).status).toBe(400);
    expect(mocks.getMercedesModels).not.toHaveBeenCalled();

    mocks.getMercedesModels.mockResolvedValueOnce({ models: [{ value: "248642", label: "248642 GLB 200", productGroup: "PC" }], productGroups: [{ value: "PC", label: "PC" }] });
    const response = await getModels(new Request("http://localhost/api/readers/mercedes/models?series=GLB%20248&productGroup=PC"));
    expect(await response.json()).toEqual({ options: [{ value: "248642", label: "248642 GLB 200", productGroup: "PC" }], productGroups: [{ value: "PC", label: "PC" }] });
    expect(mocks.getMercedesModels).toHaveBeenCalledWith("GLB 248", "PC");
  });
});
