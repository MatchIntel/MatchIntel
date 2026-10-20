-- Existing Discord-linked keys retain their ownership and activation state.
CREATE TABLE qt_website_key_batches (
 id UUID PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 plan TEXT NOT NULL CHECK (plan IN ('trial','lifetime')),
 duration_seconds BIGINT CHECK (duration_seconds > 0),
 key_count INTEGER NOT NULL CHECK (key_count BETWEEN 1 AND 1000),
 note TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qt_licenses ALTER COLUMN discord_user_id DROP NOT NULL;
ALTER TABLE qt_licenses ADD COLUMN issuance_source TEXT NOT NULL DEFAULT 'discord'
 CHECK (issuance_source IN ('discord','website'));
ALTER TABLE qt_licenses ADD COLUMN website_batch_id UUID REFERENCES qt_website_key_batches(id) ON DELETE SET NULL;
ALTER TABLE qt_licenses ADD COLUMN website_batch_position INTEGER CHECK (website_batch_position BETWEEN 1 AND 1000);
ALTER TABLE qt_licenses ADD CONSTRAINT qt_discord_key_has_owner
 CHECK (issuance_source <> 'discord' OR discord_user_id IS NOT NULL);
ALTER TABLE qt_licenses ADD CONSTRAINT qt_website_batch_source
 CHECK (website_batch_id IS NULL OR issuance_source = 'website');
CREATE UNIQUE INDEX idx_qt_website_batch_position ON qt_licenses(website_batch_id, website_batch_position)
 WHERE website_batch_id IS NOT NULL;
