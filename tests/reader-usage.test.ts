import { beforeEach, describe, expect, it } from "vitest";
import { limitReaderUsage, resetReaderUsage } from "@/lib/readers/usage";

beforeEach(() => resetReaderUsage());

describe("reader usage cap", () => {
  it("answers 429 with Retry-After once a user exceeds the window, without affecting others", () => {
    for (let index = 0; index < 120; index += 1) expect(limitReaderUsage("u1", 1000)).toBeNull();
    const limited = limitReaderUsage("u1", 2000);
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBe("59");
    expect(limitReaderUsage("u2", 2000)).toBeNull();
  });

  it("allows calls again after the window passes", () => {
    for (let index = 0; index < 120; index += 1) limitReaderUsage("u1", 1000);
    expect(limitReaderUsage("u1", 1000 + 60_000)).toBeNull();
  });
});
