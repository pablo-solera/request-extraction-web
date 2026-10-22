ALTER TYPE "extraction_status" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "extractions"
  ADD COLUMN "reader_stalled" boolean NOT NULL DEFAULT false;
