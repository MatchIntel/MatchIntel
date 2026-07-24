# MatchIntel Discord Bot v0.7.5 — Purchase Payment Safety

This release builds on v0.7.4 and does not require a backend or database change.

## What changed

- Purchase tickets display the official PayPal address: `liamlifeisgood@gmail.com`.
- Purchase tickets clearly state that only configured MatchIntel owners may accept money.
- Messages containing payment-related language in an open purchase ticket trigger a payment safety reminder.
- Automatic reminders have a 10-minute per-ticket cooldown to prevent spam.
- Owner-only `/paymentreminder` controls were added:
  - `/paymentreminder global enabled:true|false`
  - `/paymentreminder ticket enabled:true|false` — run inside a purchase ticket
  - `/paymentreminder status`
- Global settings are stored persistently in the configured ticket panel channel topic.
- Per-ticket settings are stored persistently in the ticket channel topic.
- Older ticket panels and older ticket channels remain compatible.

## Required Discord Developer Portal setting

The bot now reads messages in purchase tickets. Open the Discord Developer Portal, select the MatchIntel bot, go to **Bot**, and enable **Message Content Intent** under Privileged Gateway Intents. Without this, automatic payment-language detection cannot work.

## Optional environment variable

`MATCHINTEL_PAYPAL_EMAIL=liamlifeisgood@gmail.com`

The default is already `liamlifeisgood@gmail.com`, so this variable is optional.

## Deploy

Replace the current Discord bot folder with this one, keep the existing environment variables, optionally add `MATCHINTEL_PAYPAL_EMAIL`, enable Message Content Intent, and redeploy. Commands are registered automatically when the bot starts.
