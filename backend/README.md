# Quilted Tweaks backend 0.8.1

Deploy the enclosed backend folder contents in the original repository's backend folder and redeploy the existing Railway service. Keep PostgreSQL and current secret values. Keys and device bindings issued by the prior QT release are retained. The Qt activation protocol remains /v1/qt; familiar bot commands use /v1/qt-admin. Guild/ticket storage paths stay compatible.

Read QUILTED-SETUP.md for deployment order, commands, validation and the corrected Optimizer 2.6.1. No new required environment variable or replacement database is needed. The retired game analytics worker is no longer started.

Tests: npm ci; npm test; npm run check. Runtime Docker installs production dependencies only. CLI creation: npm run key:create -- --user DISCORD_USER_ID --duration lifetime (or 1d through 30d). Timed access starts on first activation.
