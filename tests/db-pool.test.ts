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

  it.each(["postgres://u:p@127.0.0.1:5432/db", "postgres://u:p@localhost:5432/db", "postgres://u:p@postgres:5432/db", "postgres://u:p@request-extraction-db:5432/db"])("connects without TLS to %s", async (url) => {
    vi.stubEnv("DATABASE_URL", url);
    const { getDb } = await import("@/db");
    getDb();
    expect((postgres.mock.calls.at(-1) as unknown as [string, { ssl: unknown }])[1].ssl).toBe(false);
  });

  it("requires sslmode=verify-full for a remote host", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.com:5432/db");
    const { getDb } = await import("@/db");
    expect(() => getDb()).toThrow("sslmode=verify-full");
  });

  it("sets statement and idle-in-transaction timeouts on every connection", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/db");
    const { getDb } = await import("@/db");
    getDb();
    const options = (postgres.mock.calls[0] as unknown as [string, { connection: Record<string, number> }])[1];
    expect(options.connection).toEqual({ statement_timeout: 30_000, idle_in_transaction_session_timeout: 60_000 });
  });
});
