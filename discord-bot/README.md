# Quilted Tweaks Helper 0.8.1

Based on the supplied latest 0.7.7 tickets/payments release. Uses /genkey, /keyinfo, /resetdevices and all familiar licensing commands for Quilted Tweaks by default. No product selector or separate /qtkey command. Preserves current ticket storage/buttons, Cash App, Venmo, Apple Pay, PayPal, payment reminders, emoji controls and nickname/presence.

Upload the enclosed discord-bot folder contents into the original repo's discord-bot folder (or the existing standalone bot repo root). Keep Railway root/start settings and current variables. Deploy the matching Quilted Tweaks backend 0.8.1 first; the bot uses /v1/qt-admin for licenses while preserving /v1/admin/discord for existing ticket settings. Read QUILTED-SETUP.md for exact steps.

Examples: /genkey user:@customer plan:Lifetime or /genkey user:@customer plan:Trial trial_days:7. One PC per key. Customer recovery remains /whatsmykey in private DMs.

Checks: npm ci, npm test, npm run check. Live Discord registration/delivery requires deployment.
