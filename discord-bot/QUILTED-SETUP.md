# Quilted Tweaks licensing — Optimizer 2.6.1 / services 0.8.1

This update uses the original command names. There is no product selector and no /qtkey command. /genkey creates Quilted Tweaks keys for the QT Optimizer EXE. The bot is based on the supplied 0.7.7 Quilted Tweaks Helper release, including its existing tickets, Cash App/Venmo/Apple Pay/PayPal commands, payment reminders, custom emoji controls, presence and nickname.

## Upload to the existing repository

1. Extract Quilted-Tweaks-Backend-v0.8.1.zip and replace the contents of your original repo's backend folder with its enclosed backend folder contents. Redeploy the existing Railway backend service first.
2. Extract Quilted-Tweaks-Discord-Bot-v0.8.1.zip and replace the contents of your original repo's discord-bot folder with its enclosed discord-bot folder contents. Redeploy the existing bot service second. If your bot service uses a standalone repository root instead, copy the folder's contents to that root. Do not create an extra nested discord-bot/discord-bot folder.
3. Keep your current Railway service roots, start commands, database and secret values. Existing DISCORD_*, BACKEND_URL, BACKEND_ADMIN_KEY, OWNER_DISCORD_IDS and staff/admin role variables still work. BACKEND_ADMIN_KEY must match ADMIN_API_KEY on the backend.
4. Current QUILTED_* branding/payment variables are preserved. QUILTED_UPDATES_CHANNEL_ID and QUILTED_RELEASE_* are now supported; older release variable names remain fallback aliases. The fallback announcement version is deliberately unchanged so this patch does not automatically announce an unrequested release. Change that variable only if you intend an announcement.
5. The desktop EXE still targets the previously confirmed public backend: https://matchintel-production.up.railway.app . The domain is a service address, not the displayed product name. The app does not embed server secrets. If you change the public backend domain, the app needs a build configured for the new address.
6. Open /v1/qt/config on that backend after deployment. It returns product "qt-optimizer", protocol 1, and the active Quilted version/maintenance settings. /health reports quilted-tweaks-backend 0.8.1. A 404 means the new backend has not been deployed. Deployment was not performed from this build environment.

No new environment variable is required. QUILTED_MINIMUM_APP_VERSION / QUILTED_MAINTENANCE_MODE can supply initial defaults, with the earlier QT_* equivalents accepted as fallbacks. /setversion and /maintenance save the current Quilted runtime controls in the database. Their saved values take priority over defaults. Existing Qt keys, device bindings, timers and encrypted key storage survive this update. Existing ticket IDs and guild storage paths are retained so current buttons and settings keep working. Legacy database rows are not deleted or silently converted into Quilted entitlements. The retired game's enrichment worker is no longer started by this backend.

## Familiar commands

- /genkey user:@customer plan:Lifetime — creates a one-PC Quilted Tweaks key and attempts private DM delivery.
- /genkey user:@customer plan:Trial trial_days:7 — timed access starts on first successful activation. The optional devices field accepts only 1.
- /keyinfo user:@customer — privately shows all QT keys linked to that Discord account, with page navigation.
- /keyinfo reference:KEY_OR_PREFIX_OR_UUID_OR_DEVICE_ID — keeps the existing key and binding lookup. Discord IDs and mentions are also accepted.
- /reissuekey reference:KEY_OR_UUID confirmation:REISSUE KEY — replaces the key, retains its PC binding and invalidates old sessions.
- /finduser user:@customer and /listkeys — list Quilted licenses.
- /resetdevices key license:KEY_OR_UUID or /resetdevices user user:@customer — clears device bindings without restarting trial timers.
- /devices license:KEY_OR_UUID — shows the currently bound PC.
- /revokekey, /revokeuser, /restorekey, /convertkey, /transferkey — use the original arguments for Quilted licenses.
- /extendkey and /extendallkeys — extend timed keys; pending keys remain pending and revoked keys stay revoked.
- /deletekey and /deleteallkeys — retain the original confirmation phrases and access restrictions. Deletion is permanent.
- /maintenance, /setversion, /versionstatus and /systemstatus — control/report Quilted Tweaks runtime and licensing state.
- /whatsmykey in the bot's private DM — recovers keys linked to the invoking Discord account.
- /whatsmytrialkey in DM — recovers the latest timed Quilted key already linked to that account. It does not issue a new trial or claim one from a retired website.

Staff/admin/owner command restrictions remain as in the latest supplied bot. Customer self-recovery is restricted to the invoking Discord identity. The backend still requires the shared administrator secret for bot operations. Private key delivery failure is reported rather than silently counted as delivered. All licensing changes/reveals are audited.

## EXE startup fix

The 2.6.0 activation screen used PowerShell's automatic $input variable for its key textbox, and a GetNewClosure callback read $script state from the closure's temporary module. Both behaviors were reproduced in regression tests. 2.6.1 uses a normal keyBox variable, captures the view explicitly, and delegates initialization to a root-scoped function. It activates/centers the first window, protects desktop assembly loading with the startup trap and shows/reports dispatcher exceptions. Startup traces are written to %LOCALAPPDATA%\QTOptimizer\startup-trace.txt and failures to startup-error.txt; neither logs plaintext keys or tokens.

Activation, hardware detection and HTTPS requests stay asynchronous. The existing logo/theme/animations remain. A key binds transactionally to the first PC using the client fingerprint and a server-side peppered hash. The app prefers a usable SMBIOS UUID, with Windows MachineGuid as fallback. The fallback identifies the Windows installation. This is ordinary device-bound licensing; it is not unbreakable hardware attestation.

Only the rotating refresh credential is remembered, encrypted using Windows DPAPI CurrentUser. The key entry is cleared after submission. Every launch checks the server; during use it refreshes about every five minutes. Temporary connection failures can use only the remaining server-issued lease, normally at most 15 minutes. A monotonic timer and conservative subtraction of request time prevent local clock rollback or network delay from extending that lease. Reset/revoke/expiry responses block access when checked.

On loss of access, pending launches are canceled and an active temporary tweak session is restored before the gate returns. Restoration is available without a valid key. Failed restoration retains its recovery data. Kept registry tweaks from the separate Keep tweaks for restart workflow remain until the user requests their restoration. Settings shows the plan/expiry and Use another key.

## Verification and limits

Backend checks include native activation/refresh and real HTTP/SQL tests for the original command contract, first-device binding, replay, self-recovery authorization, accurate reset counts, convert/transfer/reissue, confirmed deletion, scoped bulk controls and runtime version/maintenance. Bot checks exercise production generation/lookup/reset handlers, default API routing and all supplied ticket/payment regressions. Desktop tests reproduce the two startup language faults and exercise actual callback submission/state retention, licensing protocol, leases, restoration access and native framework compilation. The source clean-rebuild matches the EXE byte-for-byte.

This environment cannot run Windows WPF/DPAPI or log into your live Discord/Railway services. Live rendering/activation still need a Windows smoke test after deployment. If another startup failure remains, send startup-error.txt and startup-trace.txt from the folder above. No live keys were generated or services deployed during these checks.
