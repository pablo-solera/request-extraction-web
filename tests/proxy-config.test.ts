import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";
import { NextRequest } from "next/server";

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
});
