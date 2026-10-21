# Discord verification release

QT Premium Utility 3.0.0 requires backend 0.12.0 and the Helper application's Discord OAuth configuration. See [DISCORD-LINK-SETUP.md](DISCORD-LINK-SETUP.md) before deploying or distributing this version.

## Sales and expenses update — v0.11.0

Adds `/expense`, `/expenses`, `/voidexpense` and net-profit reporting. Deploy the backend first, then the bot. Existing variables and database are retained. See [SALES-SETUP.md](SALES-SETUP.md) for commands and upgrade steps.

# Quilted Tweaks backend 0.10.0

Adds **unlinked one-PC website key batches**. Read [WEBSITE-KEYS-SETUP.md](WEBSITE-KEYS-SETUP.md). Admins can use `/genwebsitekeys count:100 plan:Lifetime`, download import-ready TXT stock, and recover batches with `/websitebatches` and `/exportwebsitekeys`. Existing Discord-linked `/genkey` and all sales/dashboard features remain supported.

Adds persistent product management, manual paid-sale records, and dashboard data for the matching Discord bot. Read [SALES-SETUP.md](SALES-SETUP.md) for commands, deployment order, accounting definitions, and timezone configuration.

Deploy this backend first into your existing backend folder/repository and redeploy the existing Railway service. Preserve the PostgreSQL database and current secrets. Migration 010 adds sales tables automatically. No new required variable or database is needed. `/ready` reports version 0.10.0 once migrations finish.

Existing QT licensing (`/v1/qt` and `/v1/qt-admin`), tickets/community storage, activation timing, and owner force-update controls remain supported. Read QUILTED-SETUP.md and FORCE-UPDATE-SETUP.md for those features. The retired game analytics worker remains off.

Checks: `npm ci`, `npm run check`, `npm test`. Production Docker installs runtime dependencies only. CLI licensing: `npm run key:create -- --user DISCORD_USER_ID --duration lifetime` (or 1d through 30d).
