ALTER TABLE "extractions" DROP COLUMN IF EXISTS "stage";
ALTER TABLE "extractions" DROP COLUMN IF EXISTS "delivery_mode";
DROP TYPE IF EXISTS "public"."extraction_delivery_mode";
