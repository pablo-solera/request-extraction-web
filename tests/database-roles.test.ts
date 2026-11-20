import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("application database role", () => {
  const sql = readFileSync("db/roles/application-role.sql", "utf8").split("\n").filter((line) => !line.startsWith("--")).join("\n");

  it("grants only SELECT, INSERT and UPDATE", () => {
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public");
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|CREATE TABLE|ALL PRIVILEGES|SUPERUSER|CREATEDB|CREATEROLE)\b/i);
  });
});

const configUrl = async () => ((await import("../drizzle.config")).default as unknown as { dbCredentials: { url: string } }).dbCredentials.url;

describe("drizzle.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("prefers DATABASE_MIGRATION_URL and falls back to DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app@localhost/db");
    vi.stubEnv("DATABASE_MIGRATION_URL", "");
    expect(await configUrl()).toBe("postgres://app@localhost/db");
    vi.resetModules();
    vi.stubEnv("DATABASE_MIGRATION_URL", "postgres://owner@localhost/db");
    expect(await configUrl()).toBe("postgres://owner@localhost/db");
  });
});
