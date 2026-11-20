import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";
import { NextRequest } from "next/server";

afterEach(() => vi.unstubAllEnvs());

describe("proxy", () => {
  it("skips api, static assets and prefetch requests", () => {
    const [entry] = config.matcher as { source: string; missing: { key: string }[] }[];
    const regex = new RegExp(`^${entry.source}$`);
    expect(regex.test("/history")).toBe(true);
    expect(regex.test("/api/extractions")).toBe(false);
    expect(regex.test("/_next/static/chunk.js")).toBe(false);
    expect(regex.test("/_next/image")).toBe(false);
    expect(regex.test("/favicon.ico")).toBe(false);
    expect(entry.missing.map((item) => item.key)).toEqual(["next-router-prefetch", "purpose"]);
  });

  it("still sets a nonce-based CSP on page requests", () => {
    const response = proxy(new NextRequest("http://localhost/history"));
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });

  it("allows inline styles in development without a nonce so the Next overlay is styled", () => {
    vi.stubEnv("NODE_ENV", "development");
    const policy = proxy(new NextRequest("http://localhost/login")).headers.get("Content-Security-Policy") ?? "";
    const styleSrc = policy.split("; ").find((part) => part.startsWith("style-src")) ?? "";
    expect(styleSrc).toContain("'unsafe-inline'");
    expect(styleSrc).not.toContain("nonce-");
  });

  it("keeps style-src nonce-only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const policy = proxy(new NextRequest("http://localhost/login")).headers.get("Content-Security-Policy") ?? "";
    const styleSrc = policy.split("; ").find((part) => part.startsWith("style-src")) ?? "";
    expect(styleSrc).toMatch(/'nonce-[^']+'/);
    expect(styleSrc).not.toContain("'unsafe-inline'");
  });
});
