import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, shouldUseSecureCookie, verifySessionToken } from "@/lib/auth/session";

const originalSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
  vi.unstubAllEnvs();
});

describe("session tokens", () => {
  it("round-trips the user id", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const token = createSessionToken({ id: "user-id" });

    expect(verifySessionToken(token)).toEqual({ id: "user-id" });
  });

  it("rejects a token signed with another secret", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const token = createSessionToken({ id: "user-id" });
    vi.stubEnv("SESSION_SECRET", "another-secret-with-at-least-thirty-two-chars");

    expect(verifySessionToken(token)).toBeNull();
  });
});

describe("session cookie security", () => {
  it("is Secure by default in production and only an explicit false turns it off", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_SECURE", "");
    expect(shouldUseSecureCookie()).toBe(true);
    vi.stubEnv("SESSION_COOKIE_SECURE", "true");
    expect(shouldUseSecureCookie()).toBe(true);
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    expect(shouldUseSecureCookie()).toBe(false);
  });

  it("is not Secure outside production unless requested", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_COOKIE_SECURE", "");
    expect(shouldUseSecureCookie()).toBe(false);
    vi.stubEnv("SESSION_COOKIE_SECURE", "true");
    expect(shouldUseSecureCookie()).toBe(true);
  });
});
