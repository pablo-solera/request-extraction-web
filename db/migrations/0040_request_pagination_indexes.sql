CREATE INDEX "extraction_requests_created_idx" ON "extraction_requests" ("created_at" DESC, "request_group_id" DESC);
--> statement-breakpoint
CREATE INDEX "extraction_requests_requester_created_idx" ON "extraction_requests" ("requester_id", "created_at" DESC, "request_group_id" DESC);
