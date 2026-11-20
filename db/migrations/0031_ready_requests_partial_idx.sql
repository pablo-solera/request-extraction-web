-- Plain CREATE INDEX on purpose: CONCURRENTLY cannot run inside the drizzle-kit migration transaction and the table is small.
CREATE INDEX "extraction_requests_ready_for_load_idx" ON "extraction_requests" ("created_at") WHERE "status" = 'approved' AND "manufacturer_group" = 'BMW' AND "load_status" IS NULL;
--> statement-breakpoint
CREATE INDEX "extraction_requests_ready_for_report_idx" ON "extraction_requests" ("created_at") WHERE "status" = 'approved' AND "manufacturer_group" = 'Mercedes' AND "report_status" IS NULL;
