# Deployment layout update

Read [START-HERE.md](START-HERE.md) first. This ZIP contains the bot files directly at its top level. Upload them to the Root Directory of the existing Railway bot service. The required startup version is 0.12.2.

## List command fix — v0.12.2

Fixes `/listkeys` exceeding Discord's 1,024-character field limit; all requested results up to 25 now display. Also corrects long user/audit list layouts and updates readiness/private-reply APIs. Deploy this bot only; keep backend v0.12.1, your variables and EXE. See [LISTKEYS-FIX.md](LISTKEYS-FIX.md).

## Discord user key lookup — v0.12.1

Use `/keyinfo user:@customer` to view every linked key, including website purchases linked through QT Discord sign-in. Private staff results include full keys, plan, status, expiry, source and PC binding count, with Previous/Next pages. Deploy backend v0.12.1 first, then Helper bot v0.12.1. Keep existing variables and database. No EXE update is needed. See [KEYINFO-SETUP.md](KEYINFO-SETUP.md).

## Sales and expenses update — v0.11.0

Adds `/expense`, `/expenses`, `/voidexpense` and net-profit reporting. Deploy the backend first, then the bot. Existing variables and database are retained. See [SALES-SETUP.md](SALES-SETUP.md) for commands and upgrade steps.

# Quilted Tweaks Helper 0.10.0

Adds **unlinked one-PC website key batches**. Read [WEBSITE-KEYS-SETUP.md](WEBSITE-KEYS-SETUP.md). Admins can use `/genwebsitekeys count:100 plan:Lifetime`, download import-ready TXT stock, and recover batches with `/websitebatches` and `/exportwebsitekeys`. Existing Discord-linked `/genkey` and all sales/dashboard features remain supported.

Adds `/addproduct`, `/editproduct`, `/products`, `/confirm`, `/dashboard`, `/sales`, and `/voidsale`. Record paid sales, select products with live autocomplete, and generate private branded PNG reports of revenue and recorded profit. Read [SALES-SETUP.md](SALES-SETUP.md) for examples, permissions, deployment, and accounting details.

Deploy matching backend 0.10.0 first, then replace the files in your existing discord-bot folder or standalone bot repository and redeploy. Preserve Railway variables, secrets, and root-directory settings. Commands register automatically on bot startup. Include package-lock.json and assets/fonts in the deployment.

Existing `/genkey`, license/device management, customer recovery, tickets, official payment methods, reminders, owner force-update controls, and release announcements remain available. `/confirm` records payments; `/genkey` continues issuing keys separately. Read QUILTED-SETUP.md and FORCE-UPDATE-SETUP.md for existing configuration.

Checks: `npm ci`, `npm run check`, `npm test`. Local labeled image preview: `node scripts/preview-sales-dashboard.js preview.png`. No chart service or additional environment variable is required.
