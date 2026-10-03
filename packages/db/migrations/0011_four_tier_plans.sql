-- Preserve existing free accounts and verified paid subscriptions.
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_api_plan_check;
ALTER TABLE "user" ADD CONSTRAINT user_api_plan_check CHECK (api_plan IN ('free', 'basic', 'personal', 'professional'));
INSERT INTO usage_policy (id, request_limit) VALUES ('default', 10)
ON CONFLICT (id) DO NOTHING;
INSERT INTO usage_policy (id, request_limit) VALUES ('basic', 60)
ON CONFLICT (id) DO UPDATE SET request_limit = EXCLUDED.request_limit;
