ALTER TABLE "extraction_requests"
  ADD COLUMN "ax_code" text,
  ADD COLUMN "imc_edition" text,
  ADD COLUMN "completion" date,
  ADD COLUMN "development_start" date,
  ADD COLUMN "comments" text,
  ADD COLUMN "manufacturer_group" text,
  ADD COLUMN "brand" text;
--> statement-breakpoint
UPDATE "extraction_requests" AS r SET
  "ax_code" = first."ax_code",
  "imc_edition" = first."imc_edition",
  "completion" = first."completion",
  "development_start" = NULLIF(first."reader_params"->>'developmentStart', '')::date,
  "comments" = first."comments",
  "manufacturer_group" = first."manufacturer_group",
  "brand" = first."brand"
FROM (
  SELECT DISTINCT ON ("request_group_id") "request_group_id", "ax_code", "imc_edition", "completion", "reader_params", "comments", "manufacturer_group", "brand"
  FROM "extractions"
  ORDER BY "request_group_id", "created_at", "id"
) AS first
WHERE first."request_group_id" = r."request_group_id";
--> statement-breakpoint
DELETE FROM "extraction_requests" WHERE "ax_code" IS NULL;
--> statement-breakpoint
ALTER TABLE "extraction_requests"
  ALTER COLUMN "ax_code" SET NOT NULL,
  ALTER COLUMN "imc_edition" SET NOT NULL,
  ALTER COLUMN "completion" SET NOT NULL,
  ALTER COLUMN "manufacturer_group" SET NOT NULL,
  ALTER COLUMN "brand" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "extractions"
  DROP COLUMN "ax_code",
  DROP COLUMN "imc_edition",
  DROP COLUMN "completion",
  DROP COLUMN "comments",
  DROP COLUMN "manufacturer_group",
  DROP COLUMN "brand";
