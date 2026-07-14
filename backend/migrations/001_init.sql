CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NULL,
  max_devices INTEGER NOT NULL DEFAULT 1,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  device_name TEXT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(license_id,device_hash)
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  match_id TEXT NULL,
  pseudo_match_id TEXT NULL,
  mode TEXT NULL,
  region TEXT NULL,
  is_live BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NULL,
  ended_at TIMESTAMPTZ NULL,
  total_players INTEGER NULL,
  total_teams INTEGER NULL,
  local_player_name TEXT NULL,
  source_updated_at TIMESTAMPTZ NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS session_access (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(session_id,license_id,device_hash)
);
CREATE TABLE IF NOT EXISTS players (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_id TEXT NULL,
  team_id TEXT NULL,
  is_alive BOOLEAN NOT NULL DEFAULT TRUE,
  kills INTEGER NOT NULL DEFAULT 0,
  power_ranking NUMERIC NULL,
  lifetime_earnings NUMERIC NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(session_id,player_key)
);
CREATE TABLE IF NOT EXISTS events (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NULL,
  victim TEXT NULL,
  team_id TEXT NULL,
  weapon TEXT NULL,
  description TEXT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(session_id,event_key)
);
CREATE TABLE IF NOT EXISTS enrichment_cache (
  normalized_name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  power_ranking NUMERIC NULL,
  lifetime_earnings NUMERIC NULL,
  provider TEXT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NULL,
  target TEXT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_license ON devices(license_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(LOWER(display_name));
CREATE INDEX IF NOT EXISTS idx_events_time ON events(session_id,occurred_at DESC);
