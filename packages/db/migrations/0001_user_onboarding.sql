BEGIN;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "company" text;
-- Existing users keep access; all users created after this migration need onboarding.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profile_completed" boolean NOT NULL DEFAULT true;
ALTER TABLE "user" ALTER COLUMN "profile_completed" SET DEFAULT false;

COMMIT;
