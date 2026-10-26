CREATE TABLE "mail_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_group_id" uuid NOT NULL REFERENCES "extraction_requests"("request_group_id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "ref" text NOT NULL,
  "status" text DEFAULT 'sending' NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  CONSTRAINT "mail_notifications_status_check" CHECK ("status" IN ('sending', 'sent', 'failed')),
  CONSTRAINT "mail_notifications_attempts_check" CHECK ("attempts" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_notifications_event_unique" ON "mail_notifications" ("request_group_id", "kind", "ref");
