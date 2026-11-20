console.error([
  "db:generate is disabled: db/migrations/meta has no snapshots, so drizzle-kit would generate a migration for the whole schema.",
  "Write the next migration by hand (db/migrations/NNNN_name.sql), add it to db/migrations/meta/_journal.json with a `when` greater than the last one,",
  "and update db/schema.ts. See the Database section of README.md.",
].join("\n"));
process.exit(1);
