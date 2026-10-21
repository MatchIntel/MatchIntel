-- OAuth proof is independent of manually assigned Discord ownership.
ALTER TABLE qt_licenses ADD COLUMN discord_verified_at TIMESTAMPTZ;
ALTER TABLE qt_licenses ADD COLUMN discord_verified_user_id TEXT;
ALTER TABLE qt_licenses ADD COLUMN discord_verified_device_hash TEXT;
CREATE TABLE qt_discord_link_requests (
 id UUID PRIMARY KEY,
 license_id UUID NOT NULL REFERENCES qt_licenses(id) ON DELETE CASCADE,
 key_hash TEXT NOT NULL,
 token_version INTEGER NOT NULL,
 device_hash TEXT NOT NULL,
 device_name TEXT NOT NULL,
 poll_hash TEXT NOT NULL UNIQUE,
 start_hash TEXT NOT NULL UNIQUE,
 state_hash TEXT UNIQUE,
 browser_hash TEXT,
 verifier_ciphertext TEXT,
 phase TEXT NOT NULL DEFAULT 'pending' CHECK (phase IN ('pending','authorizing','exchanging','verified','denied','consumed','cancelled')),
 discord_user_id TEXT,
 discord_username TEXT,
 discord_display_name TEXT,
 failure_message TEXT,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 completed_at TIMESTAMPTZ
);
CREATE INDEX qt_discord_requests_license ON qt_discord_link_requests(license_id);
CREATE INDEX qt_discord_requests_expiry ON qt_discord_link_requests(expires_at);
