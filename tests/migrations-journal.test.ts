import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const journal = JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8")) as { entries: { idx: number; when: number; tag: string }[] };

describe("migration journal", () => {
  it("lists every SQL migration, in order, with strictly increasing timestamps", () => {
    const files = readdirSync("db/migrations").filter((file) => /^\d{4}_.*\.sql$/.test(file)).map((file) => file.replace(/\.sql$/, "")).sort();
    expect(journal.entries.map((entry) => entry.tag)).toEqual(files);
    journal.entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
      if (index > 0) expect(entry.when).toBeGreaterThan(journal.entries[index - 1].when);
    });
  });
});
