import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSessionClaims: vi.fn(), findUserById: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionClaims: mocks.getSessionClaims }));
vi.mock("@/lib/auth/user-repository", () => ({ findUserById: mocks.findUserById }));
vi.mock("@/lib/employees/org-service", () => ({ resolveUserRole: vi.fn() }));
vi.mock("@/lib/employees/identity-service", () => ({ resolveUserIdentities: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { requireApiUser } from "@/lib/auth/guards";

const user = { id: "u1", disabledAt: null, tokenVersion: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionClaims.mockResolvedValue({ id: "u1", tokenVersion: 2, issuedAt: 0 });
  mocks.findUserById.mockResolvedValue(user);
});

describe("session revocation", () => {
  it("accepts an active user with a matching token version", async () => {
    expect(await requireApiUser()).toEqual({ id: "u1" });
  });

  it("rejects a disabled user", async () => {
    mocks.findUserById.mockResolvedValue({ ...user, disabledAt: new Date() });
    expect(await requireApiUser()).toBeNull();
  });

  it("rejects a token issued before the version was bumped", async () => {
    mocks.findUserById.mockResolvedValue({ ...user, tokenVersion: 3 });
    expect(await requireApiUser()).toBeNull();
  });
});
