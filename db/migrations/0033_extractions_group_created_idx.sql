-- The new index is created before the old one is dropped so the request_group_id lookups are never left without an index.
-- Plain CREATE INDEX on purpose: CONCURRENTLY cannot run inside the drizzle-kit migration transaction.
CREATE INDEX "extractions_group_created_idx" ON "extractions" ("request_group_id", "created_at");
--> statement-breakpoint
DROP INDEX "extractions_group_idx";
