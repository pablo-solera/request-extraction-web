import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderError } from "@/lib/readers/errors";

const mocks = vi.hoisted(() => ({ requireApiUser: vi.fn(), getBmwTypekeyAvailability: vi.fn() }));

vi.mock("@/lib/auth/guards", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/readers/bmw/client", () => ({ getBmwTypekeyAvailability: mocks.getBmwTypekeyAvailability }));

import { GET } from "@/app/api/readers/bmw/availability/route";

const url = "http://localhost/api/readers/bmw/availability?brand=BMW&series=6%27&developmentCode=F13&typekey=YM13";

describe("BMW typekey availability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: "user-1" });
  });

  it("requires a session", async () => {
    mocks.requireApiUser.mockResolvedValueOnce(null);
    const response = await GET(new Request(url));
    expect(response.status).toBe(401);
    expect(mocks.getBmwTypekeyAvailability).not.toHaveBeenCalled();
  });

  it("returns the availability for the validated typekey with private headers", async () => {
    const availability = { typekey: "YM13", status: "unavailable", code: "CGWATB0085", suggestedTypekey: null };
    mocks.getBmwTypekeyAvailability.mockResolvedValueOnce(availability);
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getBmwTypekeyAvailability).toHaveBeenCalledWith("BMW", "6'", "F13", "YM13");
    expect(await response.json()).toEqual({ availability });
  });

  it("rejects missing, duplicated or malformed parameters before calling the reader", async () => {
    for (const query of ["brand=BMW&series=6&developmentCode=F13", "brand=BMW&series=6&developmentCode=F13&typekey=ym13", "brand=BMW&series=6&developmentCode=F13&typekey=YM13&typekey=6J02", "brand=AUDI&series=6&developmentCode=F13&typekey=YM13"]) {
      const response = await GET(new Request(`http://localhost/api/readers/bmw/availability?${query}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.getBmwTypekeyAvailability).not.toHaveBeenCalled();
  });

  it("maps reader failures to their status and a Spanish message", async () => {
    mocks.getBmwTypekeyAvailability.mockRejectedValueOnce(new ReaderError("El servicio de BMW no está disponible.", "READER_UNAVAILABLE", true));
    const response = await GET(new Request(url));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { message: "El servicio de BMW no está disponible." } });
    mocks.getBmwTypekeyAvailability.mockRejectedValueOnce(new Error("boom"));
    expect((await GET(new Request(url))).status).toBe(502);
  });
});
