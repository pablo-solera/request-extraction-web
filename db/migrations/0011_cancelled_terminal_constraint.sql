ALTER TABLE "extractions"
  DROP CONSTRAINT IF EXISTS "extractions_terminal_error_check";

ALTER TABLE "extractions"
  ADD CONSTRAINT "extractions_terminal_error_check"
  CHECK (("status" IN ('completed', 'failed', 'cancelled')) OR "completed_at" IS NULL);
