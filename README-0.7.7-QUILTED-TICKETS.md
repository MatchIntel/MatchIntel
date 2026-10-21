# Quilted Tweaks Helper — Discord Bot 0.7.7

This build updates the existing MatchIntel/Quilted Tweaks Discord bot ticket experience while preserving the existing license/backend commands.

## Ticket changes

- Default ticket panel title is **Quilted Tweaks Support**.
- Footer says **A Quilted Tweaks staff member will respond as soon as possible.**
- Default category is **Quilted Tweaks Tickets**.
- Purchase ticket button is now simply **Purchase**.
- Purchase ticket title is **Purchase Ticket**.
- Claim Ticket has the 🙋 emoji.
- Close Ticket has the 🔒 emoji.
- The bot attempts to use the server nickname **Quilted Tweaks Helper** on startup. If Discord permissions prevent that, rename the bot/member manually or give it permission to change its own nickname.

## Purchase ticket payment panel

Immediately after a Purchase ticket opens, Quilted Tweaks Helper posts and pins a large `# 💳 PAYMENT METHODS` message with the supplied custom emoji IDs and these commands:

- `!cashapp`
- `!venmo`
- `!applepay`
- `!paypal`

The commands work inside open Purchase tickets and post the official payment details from the bot.

Default payment details:

- Cash App: `$p1chtarded`
- Venmo: `@Liam-Katan`
- Apple Pay: `Ping @liamfv for further help.`
- PayPal: `liamlifeisgood@gmail.com`

## Optional Railway variables

The defaults above work without adding variables, but they can be overridden:

```env
QUILTED_BRAND_NAME=Quilted Tweaks
QUILTED_BOT_DISPLAY_NAME=Quilted Tweaks Helper
QUILTED_CASHAPP_HANDLE=$p1chtarded
QUILTED_VENMO_HANDLE=@Liam-Katan
QUILTED_APPLEPAY_CONTACT=Ping @liamfv for further help.
QUILTED_APPLEPAY_USER_ID=
QUILTED_PAYPAL_EMAIL=liamlifeisgood@gmail.com
```

If `QUILTED_APPLEPAY_USER_ID` is set to Liam's numeric Discord user ID, `!applepay` will use the actual Discord mention syntax for that account. Otherwise it displays `@liamfv` as text.

`MATCHINTEL_PAYPAL_EMAIL` is still supported as a backwards-compatible PayPal fallback.

## Deploy

Use the same Railway service/environment as the previous Discord bot. Replace the source with this folder/repo and redeploy. Existing backend/license environment variables remain unchanged.

After deploy, run `/setuptickets` again if you want to post a fresh ticket panel with the new Quilted Tweaks wording/buttons.

## Validation

`npm run check` and `npm test` were run before packaging this build.
