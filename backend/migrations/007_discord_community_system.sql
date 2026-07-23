CREATE TABLE IF NOT EXISTS discord_guild_settings (
  guild_id TEXT PRIMARY KEY,
  welcome_channel_id TEXT NULL,
  auto_role_id TEXT NULL,
  welcome_title TEXT NOT NULL DEFAULT 'Welcome to MatchIntel',
  welcome_message TEXT NOT NULL DEFAULT 'Welcome {member} to **{server}**! You are member **#{memberCount}**. Check the download and support channels to get started.',
  ticket_category_id TEXT NULL,
  ticket_panel_channel_id TEXT NULL,
  ticket_staff_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updates_channel_id TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discord_release_announcements (
  release_key TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  version TEXT NULL,
  components TEXT NULL,
  notes TEXT NULL,
  announced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discord_release_announcements_time
  ON discord_release_announcements(announced_at DESC);
