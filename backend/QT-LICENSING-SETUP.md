# QT Optimizer 2.6.0 licensing setup

The EXE is configured for https://matchintel-production.up.railway.app. The existing service was reachable at /health while this release was built, but still ran the original MatchIntel-only backend. These source packages must be deployed before the QT EXE can activate. No live Railway deployment or Discord command invocation was performed during this build.

## Deploy the backend first

1. Extract backend-QT-Licensing-v0.8.0.zip. Replace the source in the existing backend service/repository with the contents of its backend folder and redeploy it on Railway. Keep its current PostgreSQL database and existing environment variables/secrets.
2. Keep JWT_SECRET, DEVICE_HASH_PEPPER and LICENSE_KEY_ENCRYPTION_KEY unchanged. The uploaded backend's existing MatchIntel routes remain present. Do not create a replacement database.
3. Optional new variables have working defaults: QT_MINIMUM_APP_VERSION=2.6.0, QT_MAINTENANCE_MODE=false, QT_ACCESS_TOKEN_MINUTES=15. They are independent of MatchIntel version/maintenance controls.
4. Startup automatically applies migrations/009_qt_optimizer_licenses.sql using the existing migration runner. It adds qt_licenses and qt_refresh_tokens; it does not alter existing MatchIntel licenses, devices or trial histories.
5. Open https://matchintel-production.up.railway.app/v1/qt/config. A successful deployment returns product "qt-optimizer", protocol 1 and minimumVersion "2.6.0". /health also includes qtLicensing.protocol=1. A 404 means the old backend is still deployed; a 503 means configuration/database startup needs attention.

## Deploy the bot second

1. Extract discord-bot-QT-Licensing-v0.8.0.zip. Replace the source in the existing Discord bot service/repository with the contents of its discord-bot folder and redeploy it.
2. Retain DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, BACKEND_ADMIN_KEY, OWNER_DISCORD_IDS and your configured staff/admin roles. BACKEND_URL must remain https://matchintel-production.up.railway.app and BACKEND_ADMIN_KEY must match the backend's ADMIN_API_KEY. None of these secrets belongs in the desktop app.
3. On startup the bot registers the existing commands plus /qtkey in the configured guild and /qtmykey for customer recovery. Guild commands are the quickest place to check registration; global command propagation can take longer.
4. Existing MatchIntel commands, tickets, payment reminders and trial recovery remain available. Do not change release-announcement environment variables unless you intend to publish an announcement.

## Commands

- /qtkey gen user:@customer plan:Lifetime — creates a lifetime QT key. Staff/admin/owners can generate. One PC is enforced by the backend; there is no device-count override.
- /qtkey gen user:@customer plan:Timed days:7 — timer begins on its first successful activation, not when the key is generated.
- /qtkey info reference:FULL_QT_KEY_OR_UUID — staff can privately inspect the key, owner, expiry and device binding.
- /qtkey reset reference:FULL_QT_KEY_OR_UUID — admin/owner clears the binding and invalidates old sessions. It does not restart the timer.
- /qtkey revoke reference:FULL_QT_KEY_OR_UUID reason:... — admin/owner disables access.
- /qtkey restore reference:FULL_QT_KEY_OR_UUID — admin/owner restores an unexpired revoked key.
- /qtkey extend reference:FULL_QT_KEY_OR_UUID days:7 — admin/owner extends timed access; pending keys remain pending and expired activated keys extend from the current time.
- /qtkey reissue reference:FULL_QT_KEY_OR_UUID — admin/owner replaces the key and invalidates sessions while retaining the existing PC binding.
- /qtmykey — privately shows QT keys linked to the invoking customer's Discord identity.

Keys and staff results are delivered privately. Generation attempts a customer DM; when DMs are closed, the staff reply states that delivery failed. All changes/reveals are audited in the backend. Customer recovery cannot select another Discord identity.

## Desktop behavior

The activation window appears before the dashboard. It uses the existing QT logo, Inter fonts, teal theme, entrance motion, button feedback and a subtle logo-ring pulse. Hardware detection and HTTPS calls run in background PowerShell instances inside the existing process. There is no additional resident licensing process.

A key is bound transactionally to the first device that successfully activates it. The client hashes the SMBIOS UUID with a QT namespace. If firmware does not supply a usable UUID, it uses the Windows MachineGuid fallback; this fallback identifies a Windows installation. Raw UUIDs are not transmitted. The backend stores a peppered hash of the submitted QT fingerprint and enforces a single PC. Hardware/VM cloning and administrative tampering cannot be made impossible by a portable desktop app; this is a licensing gate, not hardware attestation or an unbreakable anti-tamper system.

Only a rotating refresh token is remembered, encrypted with Windows DPAPI CurrentUser and tied to the computed device fingerprint. The plaintext key is cleared from the input after submission and is not written to preferences, logs or diagnostics. The server stores key hashes and encrypted recoverable keys. The EXE contains a public service URL, never an admin API key, bot token, JWT secret or device pepper.

Every launch requires an online refresh or key activation. There is no offline unlock. During use, refresh occurs about every five minutes (sooner for short remaining leases). A temporary connection failure can use only the remaining server-issued lease, normally at most 15 minutes. Explicit expiry/revocation/reset responses lock access when checked. A monotonic local timer prevents turning the Windows clock backward from extending the current lease. Backend validation checks its own expiry timestamps.

On loss of access, pending launches are canceled, new applications/tweaks are blocked, an active temporary tweak session is restored and the activation gate returns. Pending recovery is preserved on restore failure; the gate retains a Restore Windows tweaks action without requiring a key. Kept registry settings from the separate "Keep tweaks for restart" workflow are restored only when the user chooses that restoration action. Settings shows the plan/expiry and includes Use another key; switching keys restores temporary tweaks before reactivation.

This release cannot retroactively add licensing to older unlicensed QT EXEs already distributed. Distribute the 2.6.0 EXE for the new gate.

## Checks and remaining live verification

Backend tests run actual QT SQL against PGlite (PostgreSQL-compatible), including generation, first-device binding, concurrent-call outcomes, refresh replay rejection, reset/revoke/restore, first-activation timing, extension, reissue, MatchIntel isolation and real HTTP router authorization. Bot tests cover slash schema, permissions, generation routing, private delivery payloads and self recovery. Desktop checks cover the real PowerShell parser, production protocol checks, fingerprint fallback, background runspaces, bounded lease expiry, pending launch cancellation and restoration access. Native helpers compile against official .NET Framework 4.8 references. The delivered source clean-rebuild matches the EXE byte for byte.

Windows WPF rendering, DPAPI encryption on an actual Windows account, hardware enumeration, live Discord registration/DM delivery and activation against your redeployed Railway service still require a Windows/live smoke test. A full UI-only Windows script is included at tools/test-ui-windows.ps1. No test keys were generated on the live service.
