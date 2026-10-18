# QT Premium Utility 2.8.0 / services 0.8.2

Deploy the backend first, then the Discord bot, then distribute the new EXE. Replace the contents of the existing backend and discord-bot repository folders with their matching folders from these ZIPs; keep your database, secrets, Railway roots and start commands.

Copy OWNER_DISCORD_IDS from the bot service into the backend service's variables too (the same comma-separated Discord user IDs). Existing ADMIN_API_KEY on the backend must still match BACKEND_ADMIN_KEY on the bot. No database migration is added. The /forceupdate endpoint refuses requests until backend owner IDs are configured, and it checks both the shared administrator secret and the owner actor. The bot independently checks owner IDs. Do not place these secrets in the EXE.

Upload a working EXE to a public HTTPS download page before requiring that version. The command does not host or publish the release for you.

Enable:

    /forceupdate enabled:true version:2.8.0 update_url:https://YOUR-PUBLIC-DOWNLOAD-PAGE message:Update QT Premium Utility to continue.

Release the forced requirement:

    /forceupdate enabled:false

Inspect:

    /versionstatus

The existing minimum-version floor remains in effect after releasing force update. Existing /setversion can still set that floor. The forceupdate command preserves it and uses the latest-version field for the temporary forced requirement. The current QT key, HWID binding and timers remain intact. Changes persist in the existing app_settings table and are audited.

New desktop clients check public version policy at startup and about every 60 seconds while connected, using the existing in-process timer and an asynchronous request. An active apply/restore operation finishes first. New launches and applies are blocked, pending game launches are canceled, and the app attempts to restore the active temporary session before showing the update screen. Failed restoration keeps the snapshot and exposes Restore Windows settings on that screen without requiring a license. Registry tweaks explicitly kept for restart remain available through that restore action. No app files, user files or license records are deleted. The download action opens the owner's HTTPS page in the browser; it does not silently install or execute an update.

Check again can detect a released requirement and continue through license verification. An existing network failure does not invent a force update; an already-known update requirement stays in force until a successful server check clears it. Normal licensing leases still apply.

Older EXEs cannot gain a new UI retroactively. They will receive the existing update-required activation message on their next online license check (normally within five minutes while open). The dedicated branded update screen and one-minute policy check are included starting with desktop 2.8.0. Fully offline clients cannot receive a command instantly.

Selection changes: Check all available scans all 915 catalog entries, checks the selected/installed GPU, checks Windows/browser requirements and installed optional service instances, and chooses compatible values. Opposite-vendor, unavailable/review-only entries and conflicting alternatives stay unchecked. The notification states how many were checked and skipped. Disabled service cards show the exact reason and keep Details / original command available. Protected driver-deleting scripts remain review-only.

Validation: 32 backend tests and 27 bot tests, including actual HTTP/SQL activation/refresh rejection and release, owner/non-owner checks and production bot handler tests. Desktop policy, 426 routing, recovery ordering, busy deferral and full compatible selection are tested in PowerShell fixtures. All 384 implemented import definitions retain apply/read-back/restore checks. Build, ZIP and clean-rebuild checks validate packaging. Live Discord registration, Railway deployment, Windows WPF rendering and real GPU behavior were not executed here. The Windows UI smoke test constructs the actual update gate and checks its recovery button bounds without applying changes.
