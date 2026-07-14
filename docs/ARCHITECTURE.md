# Architecture

```text
Fortnite
  ↓ Overwolf Game Events Provider
MatchIntel background controller
  ├─ sessionID / matchID
  ├─ roster entries and team IDs
  ├─ total_players / total_teams
  ├─ matchStart / matchEnd
  └─ message_feed / generic events
        ↓ HTTPS
Railway API
  ├─ licenses and devices
  ├─ JWT access + rotating refresh tokens
  ├─ session deduplication
  ├─ authorized player enrichment cache
  ├─ reports and history
  └─ admin API
        ↓
Railway PostgreSQL

Discord bot → Admin API
```

The Overwolf package never contains the database password, admin key, Discord token or provider API key.
