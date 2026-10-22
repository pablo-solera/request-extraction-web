import "server-only";

import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

type PostgresClient = ReturnType<typeof postgres>;
type Database = ReturnType<typeof drizzle<typeof schema>>;
declare global {
  var __requestExtractionPostgresClient: PostgresClient | undefined;
  var __requestExtractionDatabase: Database | undefined;
}

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to access PostgreSQL.");
  }

  if (globalThis.__requestExtractionPostgresClient && globalThis.__requestExtractionDatabase) return globalThis.__requestExtractionDatabase;

  {
    const parsedUrl = new URL(databaseUrl);
    const isLoopback = parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost";
    const isComposePostgres = parsedUrl.hostname === "postgres";
    const caPath = process.env.DATABASE_CA_CERT_PATH?.trim();

    if (!isLoopback && !isComposePostgres && parsedUrl.searchParams.get("sslmode") !== "verify-full") {
      throw new Error("Remote PostgreSQL connections must use sslmode=verify-full.");
    }

    globalThis.__requestExtractionPostgresClient = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      connect_timeout: 10,
      prepare: false,
      ssl: isLoopback || isComposePostgres
        ? false
        : {
            ca: caPath ? readFileSync(caPath) : undefined,
            rejectUnauthorized: true,
            servername: parsedUrl.hostname,
          },
    });
    globalThis.__requestExtractionDatabase = drizzle(globalThis.__requestExtractionPostgresClient, { schema });
  }

  return globalThis.__requestExtractionDatabase;
}
