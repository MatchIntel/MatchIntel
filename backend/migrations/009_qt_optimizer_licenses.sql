-- QT has independent licenses and sessions. No MatchIntel rows are changed.
CREATE TABLE IF NOT EXISTS qt_licenses (
 id UUID PRIMARY KEY,
 key_hash TEXT UNIQUE NOT NULL,
 key_prefix TEXT NOT NULL,
 key_ciphertext TEXT NOT NULL,
 plan TEXT NOT NULL CHECK (plan IN ('trial','lifetime')),
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
 duration_seconds BIGINT NULL CHECK (duration_seconds > 0),
 activated_at TIMESTAMPTZ NULL,
 expires_at TIMESTAMPTZ NULL,
 device_hash TEXT NULL,
 device_name TEXT NULL,
 bound_at TIMESTAMPTZ NULL,
 last_seen_at TIMESTAMPTZ NULL,
 token_version INTEGER NOT NULL DEFAULT 1,
 discord_user_id TEXT NOT NULL,
 discord_username TEXT NULL,
 issued_by_discord_id TEXT NOT NULL,
 note TEXT NULL,
 revoked_reason TEXT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS qt_refresh_tokens (
 id UUID PRIMARY KEY,
 license_id UUID NOT NULL REFERENCES qt_licenses(id) ON DELETE CASCADE,
 device_hash TEXT NOT NULL,
 token_version INTEGER NOT NULL,
 token_hash TEXT UNIQUE NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qt_licenses_discord ON qt_licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_qt_licenses_device ON qt_licenses(device_hash) WHERE device_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qt_refresh_license ON qt_refresh_tokens(license_id);
