import { defineConfig } from "drizzle-kit";

// Migrations need DDL rights: prefer DATABASE_MIGRATION_URL (owner role) and fall back to DATABASE_URL when only one role exists.
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

// `generate` does not connect, so importing this file must not fail without a URL; `migrate` reports the missing credentials itself.
export default defineConfig({
  dialect: "postgresql",
  out: "./db/migrations",
  schema: "./db/schema.ts",
  ...(url ? { dbCredentials: { url } } : {}),
});
