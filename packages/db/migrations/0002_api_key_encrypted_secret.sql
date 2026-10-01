ALTER TABLE api_key ADD COLUMN IF NOT EXISTS encrypted_secret text;
