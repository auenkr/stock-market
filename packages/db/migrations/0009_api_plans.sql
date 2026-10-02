ALTER TABLE "user" ADD COLUMN IF NOT EXISTS api_plan text NOT NULL DEFAULT 'free';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_api_plan_check' AND conrelid = '"user"'::regclass) THEN
    ALTER TABLE "user" ADD CONSTRAINT user_api_plan_check CHECK (api_plan IN ('free', 'paid'));
  END IF;
END $$;
INSERT INTO usage_policy (id, request_limit) VALUES ('default', 10)
ON CONFLICT (id) DO UPDATE SET request_limit = 10;
INSERT INTO usage_policy (id, request_limit) VALUES ('paid', 60)
ON CONFLICT (id) DO UPDATE SET request_limit = 60;
