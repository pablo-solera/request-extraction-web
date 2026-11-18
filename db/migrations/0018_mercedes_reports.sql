ALTER TABLE "extraction_requests"
  ADD COLUMN "report_status" text,
  ADD COLUMN "report_remote_id" text,
  ADD COLUMN "report_error" text,
  ADD COLUMN "report_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "report_start_failures" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "report_downloadable" boolean DEFAULT false NOT NULL,
  ADD COLUMN "report_requested_at" timestamp with time zone,
  ADD COLUMN "report_completed_at" timestamp with time zone,
  ADD COLUMN "report_polled_at" timestamp with time zone,
  ADD CONSTRAINT "extraction_requests_report_status_check" CHECK ("report_status" IS NULL OR "report_status" IN ('queued', 'running', 'completed', 'failed'));
--> statement-breakpoint
CREATE INDEX "extraction_requests_report_active_idx" ON "extraction_requests" ("report_requested_at") WHERE "report_status" IN ('queued', 'running');
