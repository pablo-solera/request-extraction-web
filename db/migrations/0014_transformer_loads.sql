ALTER TABLE "extraction_requests"
  ADD COLUMN "load_status" text,
  ADD COLUMN "load_remote_id" text,
  ADD COLUMN "load_error" text,
  ADD COLUMN "load_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "load_requested_at" timestamp with time zone,
  ADD COLUMN "loaded_at" timestamp with time zone,
  ADD CONSTRAINT "extraction_requests_load_status_check" CHECK ("load_status" IS NULL OR "load_status" IN ('queued', 'running', 'completed', 'failed'));
--> statement-breakpoint
CREATE INDEX "extraction_requests_load_active_idx" ON "extraction_requests" ("load_requested_at") WHERE "load_status" IN ('queued', 'running');
--> statement-breakpoint
CREATE TABLE "comparison_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_group_id" uuid NOT NULL REFERENCES "extraction_requests"("request_group_id") ON DELETE CASCADE,
  "uploaded_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "source_filename" text NOT NULL,
  "remote_report_id" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "comparison_reports_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "comparison_reports_request_created_idx" ON "comparison_reports" ("request_group_id", "created_at");
--> statement-breakpoint
CREATE INDEX "comparison_reports_active_idx" ON "comparison_reports" ("updated_at") WHERE "status" IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX "comparison_reports_uploaded_by_idx" ON "comparison_reports" ("uploaded_by_id");
