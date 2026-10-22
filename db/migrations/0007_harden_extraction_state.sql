ALTER TABLE "extraction_requests" ALTER COLUMN "status" SET DEFAULT 'pending';
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_request_group_id_extraction_requests_request_group_id_fk" FOREIGN KEY ("request_group_id") REFERENCES "public"."extraction_requests"("request_group_id") ON DELETE cascade ON UPDATE no action;

DROP INDEX IF EXISTS "extraction_requests_status_idx";
CREATE INDEX "extraction_requests_status_idx" ON "extraction_requests" USING btree ("created_at" DESC) WHERE "status" = 'pending';
CREATE INDEX "extraction_requests_coordinator_pending_idx" ON "extraction_requests" USING btree ("coordinator_id", "created_at" DESC) WHERE "status" = 'pending';
CREATE INDEX "extraction_requests_requester_idx" ON "extraction_requests" USING btree ("requester_id");
CREATE INDEX "extraction_requests_decided_by_idx" ON "extraction_requests" USING btree ("decided_by_id");
CREATE INDEX "extractions_user_active_idx" ON "extractions" USING btree ("user_id", "status") WHERE "status" IN ('pending', 'running');
DROP INDEX IF EXISTS "extractions_active_idx";
CREATE INDEX "extractions_active_idx" ON "extractions" USING btree ("updated_at") WHERE "status" IN ('pending', 'running');
