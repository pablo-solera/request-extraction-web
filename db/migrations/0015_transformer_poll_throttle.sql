ALTER TABLE "extraction_requests" ADD COLUMN "load_polled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "comparison_reports" ADD COLUMN "polled_at" timestamp with time zone;
