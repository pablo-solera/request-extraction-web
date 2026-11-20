import { defineConfig } from "drizzle-kit";

// Migrations need DDL rights: prefer DATABASE_MIGRATION_URL (owner role) and fall back to DATABASE_URL when only one role exists.
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required to run Drizzle commands.");
}

export default defineConfig({
  dialect: "postgresql",
  out: "./db/migrations",
  schema: "./db/schema.ts",
  dbCredentials: {
    url,
  },
});
