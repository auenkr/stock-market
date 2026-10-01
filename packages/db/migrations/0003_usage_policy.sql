CREATE TABLE IF NOT EXISTS "usage_policy" (
  "id" text PRIMARY KEY,
  "title" text NOT NULL DEFAULT 'Usage policy',
  "description" text NOT NULL DEFAULT 'Your API keys include the request allowance shown below.',
  "request_limit" integer NOT NULL DEFAULT 60 CHECK ("request_limit" > 0)
);
INSERT INTO "usage_policy" ("id") VALUES ('default') ON CONFLICT DO NOTHING;
