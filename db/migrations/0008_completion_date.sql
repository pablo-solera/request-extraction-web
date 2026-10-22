ALTER TABLE "extractions"
  ALTER COLUMN "completion" TYPE date
  USING CURRENT_DATE;
