CREATE TYPE "public"."extraction_request_status" AS ENUM('pending', 'approved', 'rejected');
CREATE TABLE "extraction_requests" (
  "request_group_id" uuid PRIMARY KEY NOT NULL,
  "requester_id" uuid NOT NULL,
  "coordinator_id" uuid,
  "status" "extraction_request_status" DEFAULT 'approved' NOT NULL,
  "decision_comment" text,
  "decided_by_id" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "extraction_requests" ADD CONSTRAINT "extraction_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "extraction_requests" ADD CONSTRAINT "extraction_requests_coordinator_id_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "extraction_requests" ADD CONSTRAINT "extraction_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "extraction_requests_status_idx" ON "extraction_requests" USING btree ("status", "created_at");
INSERT INTO "extraction_requests" ("request_group_id", "requester_id", "status")
SELECT DISTINCT "request_group_id", "user_id", 'approved'::"extraction_request_status"
FROM "extractions";
