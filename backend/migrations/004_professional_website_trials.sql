-- MatchIntel website-issued free trials.
--
-- The website never asks for a Device ID. A Discord-linked trial key is issued
-- first, then the existing MatchIntel app supplies its normal Device ID during
-- license activation. Only a DEVICE_HASH_PEPPER-backed hash is stored.

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS is_free_trial BOOLEAN NOT NULL DEFAULT FALSE;

-- One website trial per Discord account. This table intentionally does not use
-- an ON DELETE CASCADE foreign key: deleting a license must never restore trial
-- eligibility for that Discord account.
CREATE TABLE IF NOT EXISTS website_trial_claims (
  id UUID PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NULL,
  license_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_website_trial_claims_discord
  ON website_trial_claims(discord_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_website_trial_claims_license
  ON website_trial_claims(license_id);

-- Permanent one-free-trial-per-device enforcement. There is deliberately no
-- foreign key to licenses, so revoking/deleting/resetting a key cannot erase a
-- device's trial history. The unique license index also makes each free-trial
-- key permanently bound to the first device that activates it.
CREATE TABLE IF NOT EXISTS free_trial_device_usage (
  device_hash TEXT PRIMARY KEY,
  first_license_id UUID NOT NULL,
  first_discord_user_id TEXT NULL,
  first_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_free_trial_device_usage_license
  ON free_trial_device_usage(first_license_id);
CREATE INDEX IF NOT EXISTS idx_free_trial_device_usage_discord
  ON free_trial_device_usage(first_discord_user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_is_free_trial
  ON licenses(is_free_trial)
  WHERE is_free_trial = TRUE;
