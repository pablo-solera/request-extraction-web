import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionClaims: vi.fn(),
  findUserById: vi.fn(),
  resolveUserIdentities: vi.fn(),
  resolveUserRole: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionClaims: mocks.getSessionClaims }));
vi.mock("@/lib/auth/user-repository", () => ({ findUserById: mocks.findUserById }));
vi.mock("@/lib/employees/identity-service", () => ({ resolveUserIdentities: mocks.resolveUserIdentities }));
vi.mock("@/lib/employees/org-service", () => ({ resolveUserRole: mocks.resolveUserRole }));

import { getVerifiedUser } from "@/lib/auth/guards";

describe("getVerifiedUser", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null without a session", async () => {
    mocks.getSessionClaims.mockResolvedValue(null);
    expect(await getVerifiedUser()).toBeNull();
  });

  it("starts identity and role resolution in parallel", async () => {
    const user = { id: "u1", fallbackEmail: "f@x.com", fallbackName: "Fallback" };
    mocks.getSessionClaims.mockResolvedValue({ id: "u1" });
    mocks.findUserById.mockResolvedValue(user);
    let roleStarted = false;
    mocks.resolveUserIdentities.mockImplementation(async () => {
      await Promise.resolve();
      expect(roleStarted).toBe(true);
      return new Map([["u1", { email: "a@x.com", name: "Ana" }]]);
    });
    mocks.resolveUserRole.mockImplementation(async () => {
      roleStarted = true;
      return "admin";
    });
    const result = await getVerifiedUser();
    expect(result).toMatchObject({ id: "u1", email: "a@x.com", name: "Ana", role: "admin" });
  });
});
