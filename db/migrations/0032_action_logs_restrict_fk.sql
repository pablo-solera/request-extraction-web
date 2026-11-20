-- Audit logs must not disappear when an extraction is deleted. The FK created inline in 0012 is named extraction_action_logs_extraction_id_fkey.
-- NOT VALID + VALIDATE keeps the lock on the live table short; existing rows already satisfy the constraint.
ALTER TABLE "extraction_action_logs"
  ADD CONSTRAINT "extraction_action_logs_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "extractions"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "extraction_action_logs" VALIDATE CONSTRAINT "extraction_action_logs_extraction_id_extractions_id_fk";
--> statement-breakpoint
ALTER TABLE "extraction_action_logs" DROP CONSTRAINT "extraction_action_logs_extraction_id_fkey";
