import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { where, database } = vi.hoisted(() => {
  const where = vi.fn(() => ({ limit: async () => [] }));
  return { where, database: { select: () => ({ from: () => ({ where }) }) } };
});
vi.mock("@/db", () => ({ getDb: () => database }));

import { findUserByFallbackEmail } from "@/lib/auth/user-repository";

describe("findUserByFallbackEmail", () => {
  it("looks the email up in lowercase", async () => {
    await findUserByFallbackEmail("  Test.Manager@Solera.com ");
    const query = new PgDialect().sqlToQuery((where.mock.calls[0] as unknown as [SQL])[0]);
    expect(query.params).toEqual(["test.manager@solera.com"]);
  });
});
