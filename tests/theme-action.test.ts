import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getVerifiedUser: vi.fn(), setThemeCookie: vi.fn(), clearSessionCookie: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ getVerifiedUser: mocks.getVerifiedUser }));
vi.mock("@/lib/auth/session", () => ({ clearSessionCookie: mocks.clearSessionCookie }));
vi.mock("@/lib/theme-server", () => ({ setThemeCookie: mocks.setThemeCookie }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { setThemeAction } from "@/app/(dashboard)/actions";

describe("setThemeAction", () => {
  beforeEach(() => vi.resetAllMocks());

  it("stores a valid theme for a signed-in user", async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: "u1" });
    expect(await setThemeAction("dark")).toEqual({ ok: true });
    expect(mocks.setThemeCookie).toHaveBeenCalledWith("dark");
  });

  it("rejects unknown values without touching the cookie", async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: "u1" });
    expect(await setThemeAction("neon")).toEqual({ ok: false });
    expect(mocks.setThemeCookie).not.toHaveBeenCalled();
  });

  it("rejects requests without a valid session", async () => {
    mocks.getVerifiedUser.mockResolvedValue(null);
    expect(await setThemeAction("light")).toEqual({ ok: false });
    expect(mocks.setThemeCookie).not.toHaveBeenCalled();
  });
});
