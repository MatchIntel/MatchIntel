# MatchIntel Cito Earnings Setup

This backend adds Cito player-profile earnings to the existing MatchIntel 0.6.3 app.
The Windows app already understands the `lifetimeEarnings` field, so no new EXE is required.

## What the integration does

- Receives the lobby players from MatchIntel.
- Checks the shared PostgreSQL cache first.
- Queues only missing or expired players.
- Looks up each player using Epic account ID first.
- Falls back to the exact Fortnite display name when the account ID is not indexed.
- Reads lifetime earnings from the Cito player profile.
- Returns the earnings using MatchIntel's existing enrichment response.
- Stores successful results and unavailable-player results in PostgreSQL.
- Prevents duplicate jobs through the existing `enrichment_jobs` primary key.
- Respects the configured requests-per-minute limit.
- Handles 401/403 configuration errors, 404/unknown players, 429 rate limits, timeouts, and provider downtime.

## GitHub upload

The ZIP contains a `backend` folder. In your existing backend GitHub repository:

1. Open the `backend` folder from this package.
2. Upload everything inside it to the same place where your current `package.json`, `src`, and `migrations` folders are located.
3. Choose **Replace files** when GitHub asks about existing files.
4. Commit the changes.

Do not upload `node_modules` and do not place your Cito key in any file.

## Railway variables

Keep all of your existing Railway variables. Add or change these:

```env
ENRICHMENT_PROVIDER=cito
CITO_API_KEY=YOUR_PRIVATE_CITO_KEY
CITO_BASE_URL=https://api.citoapi.com/api/v1
CITO_CACHE_HOURS=24
CITO_NEGATIVE_CACHE_HOURS=6
CITO_REQUEST_TIMEOUT_MS=15000
CITO_REQUESTS_PER_MINUTE=10
ENRICHMENT_SEED_GLOBAL_LEADERBOARD=false
```

Set `CITO_REQUESTS_PER_MINUTE` to the limit shown for your Cito plan. The backend spaces requests so it does not exceed that value.

Recommended while testing:

```env
LATEST_APP_VERSION=0.6.3
```

Leave `MINIMUM_APP_VERSION` at its current value until you finish testing.

## Deploy and verify

After GitHub is updated, Railway should redeploy automatically.

Open:

```text
https://YOUR-RAILWAY-DOMAIN/health
```

The useful section should look similar to:

```json
{
  "enrichment": {
    "provider": "cito",
    "configured": true,
    "missingEnvironment": [],
    "requestsPerMinute": 10,
    "workerRunning": true
  }
}
```

If `configured` is false, check that `CITO_API_KEY` exists on the backend Railway service and redeploy it.

## Testing in MatchIntel

1. Keep using the MatchIntel 0.6.3 Windows app.
2. Load a tournament session.
3. The first response may show `Fetching...` because the backend queues uncached players.
4. Leave MatchIntel open. Its normal refreshes request the cache again as the worker finishes players.
5. Earnings should appear gradually, then remain cached for the configured number of hours.

A 98-player lobby takes roughly 9.8 minutes on a 10-requests-per-minute plan when every player is uncached and resolves on the first identifier. Account-ID misses that require a display-name fallback use a second API request and can extend the first load. Cached players return immediately.

## Important Cito coverage limitation

Cito focuses on indexed competitive players. A player who is not in Cito's database will remain unavailable until Cito indexes that identity. MatchIntel negative-caches those misses to avoid wasting the API allowance repeatedly.

## Files added or changed

- `src/citoProvider.js` — Cito API client and response parser.
- `src/enrichment.js` — provider routing, Cito caching, pacing, and error handling.
- `src/config.js` — Cito environment variables.
- `src/server.js` — Cito health diagnostics.
- `test/cito-provider.test.js` — provider parsing, fallback, not-found, and 429 tests.
- `.env.example` — complete Cito configuration example.
