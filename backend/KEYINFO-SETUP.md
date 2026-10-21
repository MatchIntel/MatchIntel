# Discord user key lookup — v0.12.1

## Deploy

1. Extract Quilted-Tweaks-Backend-v0.12.1.zip. Replace the matching files in the existing licensing backend repository with the contents of its backend folder. Keep the current repository layout, Railway service settings, database and variables. Push and deploy the backend first.
2. Confirm the deployment logs say `Quilted Tweaks backend 0.12.1 listening` or open `/ready` on the backend domain and confirm version `0.12.1`.
3. Extract Quilted-Tweaks-Discord-Bot-v0.12.1.zip. Replace the matching files in the existing Helper bot repository with the contents of its discord-bot folder. Keep current Railway variables. Push and deploy the bot.
4. Slash commands register automatically at bot startup. Logs now correctly identify Helper 0.12.1. Reopen Discord if its command picker still shows the old required reference option.

Do not upload an unextracted ZIP to the repository. If the repository already uses backend/ or discord-bot/ subdirectories, replace those folders in place; do not create backend/backend or discord-bot/discord-bot.

No new environment variables or database migration are required for this lookup update. Preserve the existing OAuth setup from backend v0.12.0: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI. Existing QT Premium Utility v3.0.0 works with this update; no new EXE is needed.

## Commands

- `/keyinfo user:@customer` — all QT keys linked to that account, newest first, five per page.
- `/keyinfo reference:DISCORD_USER_ID` — same lookup by pasted Discord ID; pasted mentions also work.
- `/keyinfo reference:QT-...` — existing full key, prefix, license UUID or Device ID lookup.

Choose either user or reference. Use Previous and Next to browse all linked keys. Each entry shows the full recoverable key, license ID, plan, status, expiry, PC binding count and issuance source. Revoked and expired keys remain visible with their status. Legacy unrecoverable keys show the existing reissue instruction.

Only configured staff, admins and owners in the configured server can use this lookup. Replies are ephemeral, visible only to the person running the command. Page buttons belong to that staff member and recheck their current permission on every click. No customer is DM'd or pinged. The backend requires the existing admin secret and records the reveal in the audit log without plaintext keys.

Website stock is initially unlinked. After the buyer finishes Discord authentication AND clicks Link account & open QT, that key appears under their Discord ID. Unlinked stock and other users' keys are excluded. The lookup does not transfer, activate, reset, revoke, or change keys.

## Check after deployment

1. Complete website-key linking in QT using a controlled test account/key.
2. As configured staff, run /keyinfo user:@that-account and check the exact key appears with Website purchase as its source.
3. Check an account with multiple keys and use Next/Previous when there are more than five.
4. Confirm an ordinary member cannot use staff lookup. Customer /whatsmykey remains available privately as before.

## Verification

Local automated checks cover actual database queries and HTTP routes, website OAuth linking, more than 20 owned keys, all pages, equal-timestamp ordering, revoked/expired keys, no matches, invalid inputs, staff permissions, page ownership, existing key/device searches, and backend version mismatch messages. Live Railway/Discord deployment is not performed by this package.
