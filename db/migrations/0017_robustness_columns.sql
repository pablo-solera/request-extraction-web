ALTER TABLE "extraction_requests" ADD COLUMN "load_start_failures" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "data_date" text;
--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_data_date_check" CHECK ("data_date" IS NULL OR "data_date" ~ '^[0-9]{8}$');
--> statement-breakpoint
ALTER TABLE "mail_notifications" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_notifications" DROP CONSTRAINT "mail_notifications_status_check";
--> statement-breakpoint
ALTER TABLE "mail_notifications" ADD CONSTRAINT "mail_notifications_status_check" CHECK ("status" IN ('sending', 'sent', 'failed', 'skipped'));
