# Quilted Tweaks backend 0.9.0

Adds persistent product management, manual paid-sale records, and dashboard data for the matching Discord bot. Read [SALES-SETUP.md](SALES-SETUP.md) for commands, deployment order, accounting definitions, and timezone configuration.

Deploy this backend first into your existing backend folder/repository and redeploy the existing Railway service. Preserve the PostgreSQL database and current secrets. Migration 010 adds sales tables automatically. No new required variable or database is needed. `/ready` reports version 0.9.0 once migrations finish.

Existing QT licensing (`/v1/qt` and `/v1/qt-admin`), tickets/community storage, activation timing, and owner force-update controls remain supported. Read QUILTED-SETUP.md and FORCE-UPDATE-SETUP.md for those features. The retired game analytics worker remains off.

Checks: `npm ci`, `npm run check`, `npm test`. Production Docker installs runtime dependencies only. CLI licensing: `npm run key:create -- --user DISCORD_USER_ID --duration lifetime` (or 1d through 30d).
