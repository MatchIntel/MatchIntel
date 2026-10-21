# QT Premium Utility 3.0.0 — Discord verification

This release pairs the **QT Premium Utility 3.0.0 EXE** with **Quilted Tweaks backend 0.12.0**. It uses the Discord application that already runs your **Quilted Tweaks Helper** bot. The existing v0.11.0 bot does not need a code update for linking or key recovery; its sales and expense commands remain intact.

## What the customer sees

1. Enter a valid QT key in the rounded activation window.
2. A verified-key screen appears with the Discord logo and **Continue with Discord**.
3. The default browser opens Discord's official authorization page for your Helper application.
4. After authorization, QT shows the Discord display name and username.
5. The customer clicks **Link account & open QT**. Only then does the backend link the key, bind the PC and issue an app session.

Website-stock keys remain unassigned until this confirmation. An already-owned key must authenticate as its existing Discord owner. The app cannot change an existing owner by signing in as a different account. Staff transfers still use the existing management commands.

The Helper bot's existing `/whatsmykey` recovery can find a website key after it is linked. The one-PC restriction is retained. Fresh timed keys start their countdown only after successful confirmation; existing activation and expiry times are preserved. A valid encrypted cached session can reopen the app normally; entering a key again requires Discord authentication again. Old cached activations without Discord proof must complete verification once.

## Required setup on your end

Use **the same Discord application as the Helper bot**, not a newly created application.

1. Open the Discord Developer Portal and select Quilted Tweaks Helper. Check its application name/icon; Discord's authorization screen uses those application details.
2. In that application's OAuth2 configuration, add this exact redirect URI and save:

   ```text
   https://matchintel-production.up.railway.app/v1/qt/discord/callback
   ```

3. Add these variables to the **Railway licensing/backend service** (the Node backend, not the website affiliate service):

   | Variable | Value |
   | --- | --- |
   | `DISCORD_CLIENT_ID` | The Helper bot's application/client ID. This should match the bot service's existing `DISCORD_CLIENT_ID`. |
   | `DISCORD_CLIENT_SECRET` | That application's OAuth2 client secret. This is different from the Discord bot token. |
   | `DISCORD_REDIRECT_URI` | `https://matchintel-production.up.railway.app/v1/qt/discord/callback` |

   Keep the secret in Railway only. Do not add it to GitHub, the EXE or a chat. No Discord token or OAuth secret is embedded in the app.

4. Replace the existing backend repository/folder contents with the enclosed backend source, including migration `013_qt_discord_link.sql`, then redeploy. Keep your existing database, secrets, service root and all other Railway variables. Do not reset the database.
5. Wait for `/ready` to show backend `0.12.0` and `database: ready`. `/v1/qt/config` should show `discordConfigured: true`, `activationProtocol: 2` and an effective required version of at least `3.0.0`. The public update protocol remains `1` for compatibility with existing update screens.
6. Distribute the new EXE and update your public download destination. This backend requires app 3.0.0 or newer because older apps do not implement Discord verification. Older supported update screens receive HTTP 426 with the update requirement; your existing higher version requirements still apply. Have the EXE download available when you deploy this backend.
7. Leave the existing Helper bot on v0.11.0. Its backend URL/admin secret and Discord application ID stay the same. No extra slash command or bot redeployment is needed.

The EXE continues to use the existing service address `https://matchintel-production.up.railway.app`. If you change that public backend address, the desktop's trusted endpoint and redirect configuration must be rebuilt together. Do not replace it with your affiliate website's separate Python service.

## Test after deployment

- Use a website key you control on a test PC. Enter it and confirm that no tweaking pages unlock before Discord verification.
- Authorize the Helper application, check the displayed Discord account, then confirm in QT.
- Verify the license owner through `/keyinfo` and recover it with the linked account's `/whatsmykey`.
- Close and reopen QT to check the encrypted cached session.
- Try another Discord account with that same key: it must be rejected. Try another PC without a staff device reset: it must also be rejected.
- Cancel a sign-in and retry. A stale or expired sign-in must not unlock the app.

No purchase, production Discord sign-in, live key claim, or deployment was performed during development. The complete flow is covered with synthetic Discord responses and a local PostgreSQL-compatible database. The Windows WPF screen cannot be rendered or exercised on this Linux build host; `tools/test-ui-windows.ps1` includes an additional real-Windows layout probe for the Discord confirmation controls.

## Security and recovery behavior

- The backend uses Discord's authorization-code flow, PKCE and the `identify` scope. It does not request email access, messages, server administration or bot installation permissions.
- OAuth state is random and tied to a Secure, HttpOnly, SameSite=Lax browser cookie. The app has a separate private polling secret that is not placed in the browser URL.
- OAuth credentials stay on the backend. User access tokens are used only to read the authenticated identity, are not stored, and revocation is attempted immediately afterward.
- Pending sign-ins expire after ten minutes. There are at most five active requests per key. Old requests on the same PC are replaced. Final confirmation rechecks the key, owner, expiry, token version and PC binding inside the claim transaction.
- The database records linking in the audit log. A failed audit rolls the claim back. Revoked, expired, reset or reissued keys cannot complete an older pending sign-in.
- Missing OAuth setup returns a clear setup error and does not fall back to key-only access. A bot token cannot substitute for the OAuth client secret.
- Restore Windows settings remains available on activation/update screens even without a valid license, matching existing recovery behavior.
- Polling runs only during an open Discord sign-in, using the existing app timer and asynchronous request path. No resident helper process or service is added.

Official reference: https://docs.discord.com/developers/topics/oauth2
