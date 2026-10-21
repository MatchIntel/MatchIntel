# Discord verification validation — Utility 3.0.0 / backend 0.12.0

## Completed

- All 72 backend tests and backend syntax checks pass. The 14 Discord tests exercise the production default, real HTTP router and database transactions using synthetic Discord responses.
- A key alone returns only a short-lived sign-in challenge, never an app access/refresh token. Fresh timed access does not start while the customer is waiting for Discord.
- Verified state/cookie binding, PKCE, identify-only scope, server-side code exchange, token-revocation attempt, private poll proof, expiry, cancellation, stale-request replacement and per-key request bounds.
- Verified existing-owner mismatch rejection, final in-app confirmation, one-PC binding when two PCs finish OAuth, key reissue/revocation during sign-in, audit rollback, migration of old cached activations, encrypted-session refresh and existing bot recovery of the linked website key.
- Existing sales/expense, key stock, licensing, force-update, authorization and management tests pass. Core pre-OAuth fixture suites explicitly isolate the legacy licensing layer; the new Discord suite uses the production-required default.
- Real PowerShell parsing and production-callback tests pass for activation, Discord stages and update/recovery guards. Every embedded source part is parsed. XAML templates are checked as XML.
- The final AMD64 GUI EXE passes PE section/resource/manifest/payload and recorder bundle checks. Embedded native helper hashes match their unchanged sources.
- A clean extraction of the delivered source package rebuilds to a byte-identical EXE.

## Limits

This Linux host cannot render Windows WPF, run physical Windows controller/input behavior or perform a live Discord authorization against your private Helper application. No production credentials, keys, records, bot commands or deployments were changed. Configure the OAuth variables, deploy the backend and perform the live test in DISCORD-LINK-SETUP.md before distributing the release. The source includes a real-Windows UI smoke test for the new gate's text alignment, confirmation card and footer bounds.

The tweaking catalog and engine behavior are unchanged by this authentication release; no new FPS or latency improvement is claimed.
