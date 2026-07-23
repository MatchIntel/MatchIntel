# MatchIntel Backend 0.6.0 — Player Intelligence

Main additions:

- PostgreSQL enrichment queue with `FOR UPDATE SKIP LOCKED` job claiming.
- Shared cache and duplicate-job prevention across lobbies.
- New-player-first priority and stale-while-revalidate behavior.
- Fortnite Tracker public profile parser for lifetime PR and earnings fields.
- Global earnings leaderboard seeding.
- Automatic retry and exponential backoff.
- Circuit pause after HTTP 403/429 or browser-verification responses.
- Queue/cache status at authenticated `GET /v1/enrichment/status`.
- Health endpoint remains available when Railway variables are missing.

The worker is intentionally single-request and interval-controlled by default. It does not use proxies or bypass access controls.
