BEGIN;
ALTER TABLE api_key
  ALTER COLUMN created_at SET DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp;
UPDATE api_key SET updated_at = COALESCE(revoked_at, created_at) WHERE updated_at IS NULL;
ALTER TABLE api_key
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE usage_policy
  ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION update_application_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS api_key_updated_at ON api_key;
CREATE TRIGGER api_key_updated_at BEFORE UPDATE ON api_key
FOR EACH ROW EXECUTE FUNCTION update_application_timestamp();
DROP TRIGGER IF EXISTS usage_policy_updated_at ON usage_policy;
CREATE TRIGGER usage_policy_updated_at BEFORE UPDATE ON usage_policy
FOR EACH ROW EXECUTE FUNCTION update_application_timestamp();
COMMIT;
