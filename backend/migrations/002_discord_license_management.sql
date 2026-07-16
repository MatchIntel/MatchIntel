ALTER TABLE licenses ADD COLUMN IF NOT EXISTS discord_user_id TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS discord_username TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS issued_by_discord_id TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS revoked_reason TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS plan_changed_at TIMESTAMPTZ NULL;

-- Normalize legacy plans without invalidating existing keys.
UPDATE licenses
SET plan = CASE WHEN expires_at IS NULL THEN 'lifetime' ELSE 'trial' END,
    updated_at = NOW()
WHERE plan NOT IN ('trial', 'lifetime');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'licenses_plan_matchintel_check'
  ) THEN
    ALTER TABLE licenses
      ADD CONSTRAINT licenses_plan_matchintel_check
      CHECK (plan IN ('trial', 'lifetime')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'licenses_plan_matchintel_check'
      AND convalidated = FALSE
  ) THEN
    ALTER TABLE licenses VALIDATE CONSTRAINT licenses_plan_matchintel_check;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_licenses_discord_user
  ON licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_plan_status
  ON licenses(plan, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);
