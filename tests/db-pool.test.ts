import { afterEach, describe, expect, it, vi } from "vitest";

const postgres = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("postgres", () => ({ default: postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn(() => ({})) }));

describe("database pool", () => {
  afterEach(() => {
    delete globalThis.__requestExtractionPostgresClient;
    delete globalThis.__requestExtractionDatabase;
    vi.unstubAllEnvs();
  });

  it("sets statement and idle-in-transaction timeouts on every connection", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/db");
    const { getDb } = await import("@/db");
    getDb();
    const options = (postgres.mock.calls[0] as unknown as [string, { connection: Record<string, number> }])[1];
    expect(options.connection).toEqual({ statement_timeout: 30_000, idle_in_transaction_session_timeout: 60_000 });
  });
});
