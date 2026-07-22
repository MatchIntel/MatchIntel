# MatchIntel Backend 0.6.3 — Cito Earnings

The backend now supports `ENRICHMENT_PROVIDER=cito` for lifetime competitive earnings.

Main behavior:

- PostgreSQL queue with `FOR UPDATE SKIP LOCKED` job claiming.
- Shared cache and duplicate-job prevention across lobbies.
- Epic account ID lookup first, exact display-name fallback second.
- Cito `earnings.total` / normalized USD parsing.
- Positive and negative caching.
- Configurable requests-per-minute pacing.
- Retry handling for timeouts, provider errors, and HTTP 429.
- Provider pause for invalid credentials, plan restrictions, and rate limits.
- Queue/cache status at authenticated `GET /v1/enrichment/status`.
- Provider configuration details at public `GET /health`, without exposing the key.

The API key remains only in Railway. It is never sent to the Windows client.

See `CITO-SETUP.md` for deployment instructions.
