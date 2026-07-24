-- Timed MatchIntel licenses now begin counting down only after the first
-- successful activation in the desktop app.

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS activation_duration_seconds BIGINT NULL;

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NULL;

-- Preserve the originally-issued duration for existing timed keys.
UPDATE licenses
SET activation_duration_seconds = GREATEST(
      1,
      FLOOR(EXTRACT(EPOCH FROM (expires_at - created_at)))::BIGINT
    )
WHERE plan='trial'
  AND expires_at IS NOT NULL
  AND activation_duration_seconds IS NULL;

-- Existing keys with no evidence of a successful app activation are safe to
-- convert to activation-timed keys. This also restores an unused key that may
-- have expired while sitting unclaimed.
UPDATE licenses l
SET expires_at=NULL,
    activated_at=NULL,
    updated_at=NOW()
WHERE l.plan='trial'
  AND l.expires_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM devices d WHERE d.license_id=l.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM refresh_tokens rt WHERE rt.license_id=l.id
  );

-- Keep the current expiration of keys that have already been activated while
-- recording the best available first-activation timestamp.
UPDATE licenses l
SET activated_at = COALESCE(
      l.activated_at,
      (SELECT MIN(d.first_seen_at) FROM devices d WHERE d.license_id=l.id),
      (SELECT MIN(rt.created_at) FROM refresh_tokens rt WHERE rt.license_id=l.id),
      l.created_at
    )
WHERE l.plan='trial'
  AND l.expires_at IS NOT NULL
  AND l.activated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_pending_activation
  ON licenses(created_at DESC)
  WHERE plan='trial' AND expires_at IS NULL AND activation_duration_seconds IS NOT NULL;
