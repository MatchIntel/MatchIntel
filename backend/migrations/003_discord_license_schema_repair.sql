-- Repair migration for deployments where an earlier 002 file was partially
-- applied or was already recorded before all Discord columns were present.

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS discord_user_id TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS discord_username TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS issued_by_discord_id TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS revoked_reason TEXT NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS plan_changed_at TIMESTAMPTZ NULL;

UPDATE licenses
SET plan = CASE WHEN expires_at IS NULL THEN 'lifetime' ELSE 'trial' END,
    updated_at = NOW()
WHERE plan IS NULL OR LOWER(plan) NOT IN ('trial', 'lifetime');

UPDATE licenses
SET plan = LOWER(plan), updated_at = NOW()
WHERE plan IS NOT NULL AND plan <> LOWER(plan);

-- Remove the deployment-blocking check constraint from the early 0.4.0 build,
-- if that build created it. The API already validates Trial/Lifetime plans.
ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_plan_matchintel_check;

CREATE INDEX IF NOT EXISTS idx_licenses_discord_user
  ON licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_plan_status
  ON licenses(plan, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);
