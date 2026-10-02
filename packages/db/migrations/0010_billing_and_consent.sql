ALTER TABLE "user" ADD COLUMN IF NOT EXISTS plan_expires_at timestamp with time zone;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS billing_updated_at timestamp with time zone;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS polar_customer_id text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS terms_accepted_at timestamp with time zone;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS privacy_version text;
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_api_plan_check;
-- The previous manually assigned paid tier is not proof of a subscription.
UPDATE "user" SET api_plan = 'free' WHERE api_plan = 'paid';
ALTER TABLE "user" ADD CONSTRAINT user_api_plan_check CHECK (api_plan IN ('free', 'personal', 'professional'));
INSERT INTO usage_policy (id, request_limit) VALUES ('personal', 300), ('professional', 500)
ON CONFLICT (id) DO UPDATE SET request_limit = EXCLUDED.request_limit;
DELETE FROM usage_policy WHERE id = 'paid';
