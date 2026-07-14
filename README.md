# MatchIntel Overwolf Platform

Complete source for a Fortnite tournament companion made of:

- **Overwolf client** for Fortnite Game Events, full roster/team grouping, session IDs, live counts, message feed and dashboard UI.
- **Railway backend** with PostgreSQL, server-verified license keys, device binding, access/refresh tokens, match ingestion, caching, reports, maintenance controls and admin API.
- **Discord owner bot** for creating/revoking keys, resetting devices, searching licenses and checking system status.
- **Railway and local Docker files**.

The app displays only fields actually exposed by Overwolf or an authorized enrichment provider. Anonymous roster entries remain anonymous, and missing PR/earnings are shown as **Unavailable**.

Start with `START-HERE.md`.
