import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("migration scripts", () => {
  it("refuses to run drizzle-kit generate without snapshots", () => {
    const result = spawnSync(process.execPath, ["scripts/db-generate-disabled.mjs"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("disabled");
  });

  it("applies migrations only through drizzle-kit migrate", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    expect(scripts["db:migrate"]).toBe("drizzle-kit migrate");
    expect(scripts["docker:setup-db"]).toBe("drizzle-kit migrate");
    expect(scripts["db:deploy"]).toMatch(/^drizzle-kit migrate/);
  });
});
