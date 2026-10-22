import { readdir } from "node:fs/promises";

export async function getDatabaseSqlFiles() {
  const entries = await readdir("db/migrations");
  return entries
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
    .map((file) => `db/migrations/${file}`);
}
