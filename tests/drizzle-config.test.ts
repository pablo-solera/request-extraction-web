import { afterEach, describe, expect, it, vi } from "vitest";

describe("drizzle.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses DATABASE_URL for the migration credentials", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app@localhost/db");
    const config = (await import("../drizzle.config")).default as unknown as { dbCredentials: { url: string } };
    expect(config.dbCredentials.url).toBe("postgres://app@localhost/db");
  });

  it("can be imported without any database URL (drizzle-kit generate)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(import("../drizzle.config")).resolves.toHaveProperty("default");
  });
});
