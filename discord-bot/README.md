# Quilted Tweaks Helper 0.9.0

Adds `/addproduct`, `/editproduct`, `/products`, `/confirm`, `/dashboard`, `/sales`, and `/voidsale`. Record paid sales, select products with live autocomplete, and generate private branded PNG reports of revenue and recorded profit. Read [SALES-SETUP.md](SALES-SETUP.md) for examples, permissions, deployment, and accounting details.

Deploy matching backend 0.9.0 first, then replace the files in your existing discord-bot folder or standalone bot repository and redeploy. Preserve Railway variables, secrets, and root-directory settings. Commands register automatically on bot startup. Include package-lock.json and assets/fonts in the deployment.

Existing `/genkey`, license/device management, customer recovery, tickets, official payment methods, reminders, owner force-update controls, and release announcements remain available. `/confirm` records payments; `/genkey` continues issuing keys separately. Read QUILTED-SETUP.md and FORCE-UPDATE-SETUP.md for existing configuration.

Checks: `npm ci`, `npm run check`, `npm test`. Local labeled image preview: `node scripts/preview-sales-dashboard.js preview.png`. No chart service or additional environment variable is required.
