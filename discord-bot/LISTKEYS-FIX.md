# Helper v0.12.2 — list command fix

Deploy this bot update to the existing Helper bot service. Extract the ZIP, replace the matching bot repository files with the top-level contents of this ZIP, commit/push and deploy. Keep Railway variables and the database. No backend or EXE update is needed for this fix. Backend v0.12.1 remains the current backend for Discord-user /keyinfo.

/listkeys now gives each key its own bounded field instead of placing the entire list in one 1,024-character field. All requested results (up to 25) are retained, including owner, prefix, plan, status, device count and license ID. Empty results and status/plan filters remain supported. Replies stay private to staff and suppress customer pings.

The same field-length error was corrected in /finduser and /auditlog; long text now uses the larger embed description limit. The bound-device view also uses that layout. Existing /keyinfo user:@customer pages remain available.

Discord readiness now uses Events.ClientReady. Private replies use MessageFlags.Ephemeral instead of the deprecated ephemeral option.

Verification: syntax checks and all automated bot tests pass, including the reported 15-key case, 25 keys, empty results, filters, complete license IDs, Discord field/description/total limits, private reply flags and long user/audit lists. Live Discord deployment was not performed.
