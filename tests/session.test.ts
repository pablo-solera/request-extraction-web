import { afterEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { createSessionToken, shouldUseSecureCookie, verifySessionToken } from "@/lib/auth/session";
import { shouldRenewSession } from "@/lib/auth/token";

const originalSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
  vi.unstubAllEnvs();
});

describe("session tokens", () => {
  it("round-trips the user id and the token version", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const token = createSessionToken({ id: "user-id", tokenVersion: 3 });

    expect(verifySessionToken(token)).toMatchObject({ id: "user-id", tokenVersion: 3 });
  });

  it("expires after two hours", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const payload = jwt.decode(createSessionToken({ id: "user-id", tokenVersion: 0 })) as { iat: number; exp: number };

    expect(payload.exp - payload.iat).toBe(2 * 60 * 60);
  });

  it("rejects tokens without a token version", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const legacy = jwt.sign({}, process.env.SESSION_SECRET!, { algorithm: "HS256", audience: "request-extraction-users", issuer: "request-extraction-web", subject: "user-id", expiresIn: 60 });

    expect(verifySessionToken(legacy)).toBeNull();
  });

  it("renews only tokens older than half an hour", () => {
    const claims = { id: "user-id", tokenVersion: 0, issuedAt: 1000 };

    expect(shouldRenewSession(claims, 1000 + 60)).toBe(false);
    expect(shouldRenewSession(claims, 1000 + 30 * 60)).toBe(true);
  });

  it("rejects a token signed with another secret", () => {
    vi.stubEnv("SESSION_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const token = createSessionToken({ id: "user-id", tokenVersion: 0 });
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
