# Quilted Tweaks sales dashboard — 0.9.0

## Deploy

1. Replace the files in your existing backend repository/folder with the contents of the matching `backend` folder. Redeploy the backend first. Keep its PostgreSQL database, existing variables, secrets, and Railway root directory.
2. Wait until backend `/ready` reports version `0.9.0` and database `ready`. Migration `010_qt_sales_ledger.sql` runs automatically under the existing migration lock. It adds new tables without deleting keys, settings, or tickets.
3. Replace the existing bot repository/folder with the contents of `discord-bot`, keeping its Railway variables and root directory. Redeploy. The bot registers the new slash commands on startup in `DISCORD_GUILD_ID`.
4. Check that bot `BACKEND_ADMIN_KEY` matches backend `ADMIN_API_KEY`. Existing `OWNER_DISCORD_IDS`, `BOT_ADMIN_ROLE_IDS`, and `BOT_STAFF_ROLE_IDS` keep controlling access. No new required variables or external chart service are needed.

The bot Dockerfile runs `npm ci --omit=dev`. Dashboard rendering includes its own fonts and a precompiled SVG renderer, so it does not depend on fonts, Chromium, Python, or graphics packages installed on Railway. Keep `assets/fonts` and the lockfile in the deployment.

## Commands

All commands below reply privately to the invoking user. No financial report is posted in a public channel or sent to a customer.

| Command | Access | Purpose |
| --- | --- | --- |
| `/addproduct name:QT Premium Utility price:25 cost:0` | Admin/owner | Save a product, unit price, and optional unit cost. |
| `/editproduct product:<choose> price:30` | Admin/owner | Change the default price. Also supports `name`, `cost`, and `active`. |
| `/editproduct product:<choose> active:false` | Admin/owner | Archive the product; earlier sales remain in reports. Use `true` to re-enable it. |
| `/products` | Staff/admin/owner | Show up to 25 saved products and prices. Use `search` or `archived:true` to find more. |
| `/confirm product:<choose> price:25` | Staff/admin/owner | Record an already-paid sale. Price is optional and defaults to the saved unit price. |
| `/dashboard period:30d` | Admin/owner | Generate a PNG dashboard with revenue, recorded profit, orders, units, average sale, daily trends, and top products. |
| `/sales limit:10` | Admin/owner | Show recent sale IDs for review and corrections. `voided:true` includes voided entries. |
| `/voidsale sale_id:<full ID> reason:Wrong price` | Admin/owner | Exclude a mistaken entry from reports while preserving its audit history. |

### Example

```
/addproduct name:QT Premium Utility price:25
/addproduct name:Full Optimization price:35 cost:5
/confirm product:QT Premium Utility price:20 fee:0.90 reference:PAYMENT-TRANSACTION-ID
/dashboard period:30d
```

Select the product suggestion when typing its name. Products are searchable immediately after adding/editing; no restart or command re-registration is needed. A product ID copied from `/products` also works.

`/confirm` additionally supports:

- `quantity`: number of units, default 1. `price` and `cost` are per unit.
- `cost`: actual unit cost, overriding the saved default. Omit it to use the saved cost.
- `fee`: total payment processing fee for the whole order, default zero.
- `customer`: optional Discord account, stored privately in the sale record.
- `reference`: payment transaction/order identifier. An active reference can only be recorded once per server, case-insensitively. Always enter it when available.
- `sold_on`: optional earlier sale date, `YYYY-MM-DD`, interpreted at noon in your business timezone. Omit it to record the current time. Future dates are rejected.
- `note`: optional private note.

`/confirm` records a payment you already received. It does not verify a payment with PayPal/Stripe/Cash App, collect money, issue a key, or message the customer. Continue using `/genkey` for license delivery. Existing commands, tickets, payment reminders, keys, and force-update controls are retained.

## Accounting and reports

- This release records **USD only**; it does not mix currencies or convert exchange rates.
- Revenue = unit price × quantity.
- Recorded profit = revenue − unit cost × quantity − payment fees.
- Costs and fees default to zero when not recorded. Profit excludes expenses, taxes, refunds, and other costs you do not enter; it is not a full accounting statement.
- Editing or archiving a product never rewrites earlier sale names, prices, or costs. The top-product leaderboard uses each product's current name and historical amounts.
- `/dashboard` supports `7d`, `30d`, `90d`, or `all`, plus an optional `product` filter. All-time totals cover the full ledger; its daily chart shows the last 30 days. Other periods include today and the preceding calendar days.
- Business timezone defaults to **America/New_York**. You can set optional backend `SALES_TIMEZONE` to a valid IANA timezone. Day boundaries account for daylight saving time.
- Data is stored in PostgreSQL, separate from licensing, and survives bot/backend redeploys. Keep the existing database and backups.
- Re-delivery of the same Discord interaction returns the existing sale, without adding revenue twice. Payment-reference uniqueness also catches separate `/confirm` commands for the same payment. Without a reference, separate commands count as separate sales.
- To correct an entry, void it, then re-record the correct sale. A voided reference can be reused for the correction. Voiding does not send refunds, revoke keys, or remove audit records.
- Old sales are not inferred from keys or tickets. Backfill actual paid orders using `/confirm sold_on:...` if needed.

## Validation and preview

Run `npm ci`, `npm run check`, and `npm test` in each folder. Tests cover the real HTTP routes and PostgreSQL-compatible migrations/transactions, permission checks, cent arithmetic, product history, retries, payment-reference duplicates, voiding, daily timezone/DST boundaries, and actual PNG output including empty/loss cases.

In the `discord-bot` folder, generate a labeled local demo image with `node scripts/preview-sales-dashboard.js preview.png`. This does not connect to Discord or record any sales.

Live slash-command registration, role configuration, channel permissions, and Railway deployment must be checked in your own environment after deploying. If attaching images fails, confirm the bot has **Attach Files** and **Embed Links** in the channel where you invoke `/dashboard`.
