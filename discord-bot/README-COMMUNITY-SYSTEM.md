# MatchIntel Community System 0.7.4

This update adds the requested Discord community features while keeping all existing license-management commands.

## Added

- Custom welcome message in a selected channel.
- Automatic role for every new non-bot member.
- Private `/whatsmykey` and `/whatsmytrialkey` commands available in MatchIntel Helper DMs.
- Timed license countdowns begin only after first successful app activation.
- Full ticket panel with private ticket channels.
- Ticket claim, close, reopen, and permanent-delete controls.
- `/sendthismessage` for owner-posted messages, images, and files as MatchIntel Helper.
- `/publishupdate` for client, backend, bot, and website release announcements.
- Automatic one-time release announcement in channel `1529448180213874740`.
- Persistent welcome/ticket settings stored in PostgreSQL.

## Deploy in this order

### 1. Backend

Replace the files in your existing repository's `/backend` directory with the contents of the supplied `backend` folder, commit, and push. Railway will run all pending migrations automatically, including `008_activation_timed_licenses.sql`.

Keep every existing Railway variable unchanged.

**License-key encryption warning:** do not change `JWT_SECRET` or `LICENSE_KEY_ENCRYPTION_KEY`. Existing recoverable keys can only be decrypted with the same secret that encrypted them. When `LICENSE_KEY_ENCRYPTION_KEY` was never set, MatchIntel uses the existing `JWT_SECRET` as the fallback; leave that arrangement unchanged.

The backend health endpoint should report version `0.7.4` after deployment.

### 2. Discord bot

Replace the files in your existing repository's `/discord-bot` directory with the supplied `discord-bot` folder, commit, and push.

Keep the existing variables and add/confirm:

```env
MATCHINTEL_UPDATES_CHANNEL_ID=1529448180213874740
MATCHINTEL_RELEASE_VERSION=0.7.4
MATCHINTEL_RELEASE_COMPONENTS=Discord bot + backend
MATCHINTEL_RELEASE_NOTES=Added welcome messages, automatic roles, private tickets, DM key recovery, announcement tools, and release posts.
```

The bot automatically posts that release once. Future releases can be posted with `/publishupdate`, or by changing the three release values and redeploying the bot.

## Discord Developer Portal

Open the MatchIntel application, select **Bot**, and enable **Server Members Intent**. The welcome and automatic-role event requires it.

The MatchIntel Helper bot role needs:

- Manage Roles
- Manage Channels
- View Channels
- Send Messages
- Embed Links
- Attach Files
- Read Message History

Move the MatchIntel Helper role above the role it will assign automatically.

## Configure the server

### Welcome and automatic role

Run:

```text
/setupwelcome
```

Select the welcome channel and automatic role. The optional message supports:

```text
{member} {server} {memberCount}
```

Preview it with:

```text
/testwelcome
```

### Ticket panel

Run this command in the public channel where the ticket button should appear:

```text
/setuptickets
```

You may choose an existing category, support role, and moderator role. When no category is selected, the bot creates `MatchIntel Tickets`.

A ticket is visible only to:

- the person who opened it;
- configured ticket/support/mod roles;
- existing MatchIntel staff and admin roles;
- configured MatchIntel owners;
- MatchIntel Helper itself.

Staff can claim tickets. The opener or staff can close them. Staff can reopen them. Admins and owners can permanently delete them.

### Private key recovery

A customer opens MatchIntel Helper's profile, presses **Message**, and runs:

```text
/whatsmykey
```

Use `/whatsmytrialkey` to recover the exact website-issued free-trial key. Both commands refuse to reveal a key publicly in the server. It only returns keys linked to the Discord account that invoked the DM command and includes a warning not to share them.

Keys created after secure key recovery was enabled have an encrypted recoverable value. An older key that only has a hash cannot be mathematically reconstructed; the bot will say that it needs to be reissued. Staff can use `/reissuekey`, which invalidates the old value and creates a new recoverable key.

### Post as MatchIntel Helper

Configured owners can run:

```text
/sendthismessage
```

It supports text, an optional embed title, up to three images/files, and an optional mention toggle. The message is sent in the channel where the command is run.

### Publish project changes

Configured owners can run:

```text
/publishupdate
```

Choose Client, Backend, Discord bot, Website, or Multiple components. It defaults to channel `1529448180213874740` and supports an attached release file.

## Quick test checklist

1. Join with a test account and confirm the automatic role and welcome message.
2. Press **Open a ticket** and verify normal members cannot see the ticket.
3. Claim, close, reopen, and delete a test ticket.
4. DM MatchIntel Helper and run `/whatsmykey`.
5. Run `/sendthismessage` with an image.
6. Confirm the 0.7.4 release announcement appears once in `1529448180213874740`.
