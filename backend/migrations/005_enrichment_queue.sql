ALTER TABLE enrichment_cache
  ADD COLUMN IF NOT EXISTS account_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS region TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS next_refresh_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_error TEXT NULL;

UPDATE enrichment_cache
SET
  last_checked_at = COALESCE(last_checked_at, updated_at),
  last_success_at = CASE
    WHEN power_ranking IS NOT NULL OR lifetime_earnings IS NOT NULL
      THEN COALESCE(last_success_at, updated_at)
    ELSE last_success_at
  END,
  next_refresh_at = COALESCE(next_refresh_at, expires_at),
  status = CASE
    WHEN power_ranking IS NOT NULL OR lifetime_earnings IS NOT NULL THEN 'ready'
    ELSE 'unavailable'
  END
WHERE last_checked_at IS NULL OR next_refresh_at IS NULL;

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  normalized_name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  account_id TEXT NULL,
  region TEXT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enrichment_jobs_ready_idx
  ON enrichment_jobs(status, run_after, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS enrichment_cache_refresh_idx
  ON enrichment_cache(next_refresh_at ASC);
