CREATE TABLE "extraction_action_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "extraction_id" uuid NOT NULL REFERENCES "extractions"("id") ON DELETE CASCADE,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "outcome" text NOT NULL,
  "reader_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "extraction_action_logs_action_check" CHECK ("action" IN ('cancel', 'resume', 'force_resume')),
  CONSTRAINT "extraction_action_logs_outcome_check" CHECK ("outcome" IN ('succeeded', 'failed'))
);

CREATE INDEX "extraction_action_logs_extraction_created_idx" ON "extraction_action_logs" USING btree ("extraction_id", "created_at");
CREATE INDEX "extraction_action_logs_actor_created_idx" ON "extraction_action_logs" USING btree ("actor_id", "created_at");
