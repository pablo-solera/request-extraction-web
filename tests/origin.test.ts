import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOrigin, rejectCrossOrigin } from "@/lib/security/origin";

function post(headers: Record<string, string>) {
  return new Request("http://app.internal/api/requests/x/load/retry", { method: "POST", headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("origin check", () => {
  it("accepts the origin that matches the Host header", () => {
    expect(isSameOrigin(post({ origin: "http://app.internal", host: "app.internal" }))).toBe(true);
  });

  it("accepts the forwarded host behind a reverse proxy", () => {
    expect(isSameOrigin(post({ origin: "https://public.example", host: "10.0.0.5:3000", "x-forwarded-host": "public.example" }))).toBe(true);
  });

  it("accepts APP_BASE_URL, with or without protocol", () => {
    vi.stubEnv("APP_BASE_URL", "public.example");
    expect(isSameOrigin(post({ origin: "https://public.example", host: "10.0.0.5:3000" }))).toBe(true);
  });

  it("rejects a foreign, null or missing origin with 403", async () => {
    for (const headers of <Record<string, string>[]>[{ origin: "https://evil.example", host: "app.internal" }, { origin: "null", host: "app.internal" }, { host: "app.internal" }]) {
      const response = rejectCrossOrigin(post(headers));
      expect(response?.status).toBe(403);
    }
  });

  it("lets a same-origin request continue", () => {
    expect(rejectCrossOrigin(post({ origin: "http://app.internal", host: "app.internal" }))).toBeNull();
  });
});
