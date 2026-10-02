CREATE TABLE IF NOT EXISTS "account_usage" (
  "user_id" text PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "window_started_at" timestamp NOT NULL DEFAULT now(),
  "request_count" integer NOT NULL DEFAULT 0 CHECK ("request_count" >= 0),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS "account_usage_updated_at" ON "account_usage";
CREATE TRIGGER "account_usage_updated_at" BEFORE UPDATE ON "account_usage"
FOR EACH ROW EXECUTE FUNCTION update_application_timestamp();
ALTER TABLE "usage_policy" ALTER COLUMN "description"
SET DEFAULT 'Your account''s API keys share the request allowance shown below.';
UPDATE "usage_policy" SET "description" = 'Your account''s API keys share the request allowance shown below.'
WHERE "description" = 'Your API keys include the request allowance shown below.';
