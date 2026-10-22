CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "public"."extraction_domain" AS ENUM('parts', 'labours');
CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'running', 'completed', 'failed');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "session_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "extractions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "request_group_id" uuid NOT NULL,
  "ax_code" text NOT NULL,
  "imc_edition" text NOT NULL,
  "completion" text NOT NULL,
  "comments" text,
  "manufacturer_group" text NOT NULL,
  "brand" text NOT NULL,
  "model_description" text NOT NULL,
  "model_code" text NOT NULL,
  "domain" "extraction_domain" NOT NULL,
  "reader_key" text NOT NULL,
  "reader_params_version" integer DEFAULT 1 NOT NULL,
  "reader_params" jsonb NOT NULL,
  "remote_request_id" text,
  "status" "extraction_status" DEFAULT 'pending' NOT NULL,
  "error_code" text,
  "error_message" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submitted_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "extractions" ADD CONSTRAINT "extractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");
CREATE INDEX "extractions_user_created_idx" ON "extractions" USING btree ("user_id", "created_at");
CREATE INDEX "extractions_group_idx" ON "extractions" USING btree ("request_group_id");
CREATE INDEX "extractions_active_idx" ON "extractions" USING btree ("status", "updated_at");
CREATE UNIQUE INDEX "extractions_reader_remote_unique" ON "extractions" USING btree ("reader_key", "remote_request_id") WHERE "remote_request_id" IS NOT NULL;
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_terminal_error_check" CHECK (("status" IN ('completed', 'failed')) OR "completed_at" IS NULL);
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_reader_params_object_check" CHECK (jsonb_typeof("reader_params") = 'object');
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_attempt_count_check" CHECK ("attempt_count" >= 0);
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_failed_error_check" CHECK ("status" <> 'failed' OR "error_code" IS NOT NULL);
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_completed_date_check" CHECK ("status" <> 'completed' OR "completed_at" IS NOT NULL);
