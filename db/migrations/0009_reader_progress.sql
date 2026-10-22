ALTER TABLE "extractions"
  ADD COLUMN "progress" integer,
  ADD COLUMN "reader_status" text,
  ADD COLUMN "reader_polled_at" timestamp with time zone;

ALTER TABLE "extractions"
  ADD CONSTRAINT "extractions_progress_range_check"
  CHECK ("progress" IS NULL OR ("progress" >= 0 AND "progress" <= 100));
