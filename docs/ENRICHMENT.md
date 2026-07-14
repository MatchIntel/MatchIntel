# PR and earnings enrichment

MatchIntel's Railway backend can call an authorized player profile provider without exposing its secret to the Overwolf client.

Set:

```env
ENRICHMENT_ENDPOINT_TEMPLATE=https://provider.example/players/{name}
ENRICHMENT_API_HEADER=x-api-key
ENRICHMENT_API_KEY=YOUR_SECRET
ENRICHMENT_CACHE_HOURS=24
```

The response adapter recognizes common fields:

```json
{
  "displayName": "Player",
  "powerRanking": 42000,
  "lifetimeEarnings": 125000
}
```

It also recognizes `pr`, `power_ranking`, `earnings`, `lifetime_earnings`, and nested `stats.pr`/`stats.earnings`.

Anonymous names are skipped. MatchIntel caches valid and unavailable results so it does not repeatedly call a paid provider.
