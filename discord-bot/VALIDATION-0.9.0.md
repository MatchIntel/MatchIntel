# Version 0.9.0 validation

- Backend: 42 tests passed; bot: 36 tests passed (78 total).
- Syntax checks passed for both projects, including all new sales modules.
- Applied all migrations 001 through 010 to a fresh PostgreSQL-compatible PGlite database. Existing license and Discord settings tables coexist with the new sales ledger.
- Exercised actual Express sales routes and the production /v1/qt-admin mount with HTTP requests.
- Verified cents arithmetic, default/override prices, quantities, fees, negative profit, history snapshots, duplicate interaction/payment-reference handling, archival, void corrections, database transaction rollback, cross-server isolation, and New York/DST day boundaries.
- Verified real Discord command definitions, handlers, access restrictions, product autocomplete, private reply payloads, embed size limits, and existing licensing/ticket/force-update behavior.
- Generated actual 1400x1000 PNG dashboard images for normal, empty, and loss data. Inspected the labeled demo image visually.
- Extracted the distributable bot ZIP into a clean folder, installed production dependencies with npm ci --omit=dev, and rendered a PNG using only the packaged fonts/renderer.
- Archive CRC and required-file checks passed. Packages exclude node_modules and live .env files.

Validation ran locally on Linux with Node 24. Live Railway deployment, Discord gateway command registration, actual server-role IDs, and Discord attachment delivery were not performed. Existing Dockerfiles target Node 22.
