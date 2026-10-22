import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

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
