ALTER TABLE "usage_policy" ALTER COLUMN "request_limit" SET DEFAULT 10;
UPDATE "usage_policy" SET "request_limit" = 10
WHERE "id" = 'default' AND "request_limit" = 60;
