# Quilted Tweaks sales and expenses — v0.11.0

## Deploy the update

1. Replace the files in the existing **backend** repository/folder with this package's `backend` contents. Keep the PostgreSQL database, Railway variables and root directory. Deploy the backend first.
2. Wait for `/ready` to show `version: 0.11.0` and `database: ready`. Migration `012_qt_expenses.sql` runs automatically. It adds the expense table and indexes; existing sales, keys and tickets are retained. Do not reset the database or rerun old migrations manually.
3. Replace the bot repository/folder with the updated `discord-bot` contents and redeploy. Its startup registers the new commands in `DISCORD_GUILD_ID`.
4. No new variables are needed. Keep bot `BACKEND_ADMIN_KEY` equal to backend `ADMIN_API_KEY`. The configured `OWNER_DISCORD_IDS`, `BOT_ADMIN_ROLE_IDS` and `BOT_STAFF_ROLE_IDS` continue to control access. Keep the included lockfiles and `assets/fonts` directory.

## Record a purchase made with your earnings

Use this after you have actually paid for something:

```
/expense amount:20 description:Railway hosting category:Hosting
/dashboard period:all
```

The expense is subtracted from net profit immediately in the next dashboard report. This command only records a purchase; it does not transfer money, connect to your bank, or verify a receipt.

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/expense amount:20 description:Railway hosting` | Admin/owner | Record a purchase or business expense. |
| `/expenses` | Admin/owner | Privately list recent purchases and expense IDs. |
| `/voidexpense expense_id:<ID> reason:Duplicate entry` | Admin/owner | Exclude an incorrect expense while preserving its audit record. |
| `/dashboard period:all` | Admin/owner | Generate a private image with revenue, business expenses, net profit, sales and daily trends. |
| `/confirm product:<choose> price:25` | Staff/admin/owner | Record a sale that has already been paid. |
| `/products` | Staff/admin/owner | Find saved products and their IDs. |
| `/addproduct name:Premium Utility price:15 cost:0` | Admin/owner | Save a product and its default USD unit price and cost. |
| `/editproduct product:<choose> price:20` | Admin/owner | Change defaults, name or archive status without rewriting earlier sales. |
| `/sales` | Admin/owner | Review recent sales and IDs. |
| `/voidsale sale_id:<ID> reason:Wrong amount` | Admin/owner | Exclude an incorrect sale while keeping its audit history. |

All these commands reply privately. Ordinary members and configured staff without admin access cannot view or record expenses or generate financial reports.

## Optional expense details

- `category`: for example Hosting, Advertising, Equipment, Software or Affiliate commission. Defaults to Other.
- `spent_on`: an existing local calendar date in `YYYY-MM-DD`, for example `2026-10-19`. Leave blank to record now. Future or invalid dates are rejected. Backdated entries are placed at noon in the configured business timezone.
- `reference`: a receipt or transaction ID. Use it when available: active expense references are unique within the server, ignoring letter case. It is separate from sale references.
- `product`: choose a product only when the purchase belongs specifically to that product. Leave blank for a general business expense such as shared hosting. Archived products can still have expenses recorded against them.

The amount is the **entire expense**, in USD, from $0.01 to $1,000,000, with at most two decimal places. Include shipping or purchase taxes in that total if you want them counted. No exchange-rate conversion is performed. To fix an amount, void the old expense and record the corrected one; entries are not silently rewritten or deleted. Voided entries can be shown with `/expenses voided:true`.

## How profit is calculated

**Net profit = recorded sales revenue − recorded sale costs − recorded payment fees − recorded business expenses.**

Example: $100 revenue − $10 sale cost − $2 payment fee − $20 hosting = **$68 net profit**.

Do not record the same purchase twice, such as both an expense and a cost or fee on `/confirm`. Affiliate commissions and other spending must be entered if you want them subtracted. These are totals from recorded entries, not a verified bank balance or a tax return. Unrecorded purchases, fees, refunds, taxes and payouts cannot be included automatically.

`/confirm` still accepts unit `price`, unit `cost`, `quantity`, total payment `fee`, optional `customer`, `reference`, `sold_on` and `note`. Leaving price/cost blank uses saved defaults. It records received payments; it does not collect money, verify payment with a provider, generate a key or import SellAuth orders. Continue using `/genkey` for keys. This update does not automatically synchronize website sales or affiliate payouts into this separate manual ledger.

## Reporting windows and product filters

- `/dashboard` defaults to 30 days. Select `7d`, `30d`, `90d` or `all`.
- Use `period:all` to see lifetime profit after every recorded expense, rather than only the latest month's transactions. All-time totals include the full history; its daily chart shows the last 30 days.
- With **no product filter**, all recorded expenses are deducted exactly once, including general expenses and those linked to individual products.
- With a **product filter**, only that product's sales and explicitly linked expenses are included. General shared expenses are excluded, and the image and reply say so. Shared costs are not automatically divided between products.
- The top-products rows show sales profit before separate business expenses; this is labeled on the image. The net-profit card and daily chart include expenses according to the selected filter.
- An expense on a day with no sales creates negative net profit for that day. An account with no sales can therefore show a loss.
- The default business timezone is America/New_York. Existing optional backend `SALES_TIMEZONE` settings are retained, and calendar boundaries handle daylight saving time.

## Data safety and testing

Entries are stored in the existing PostgreSQL database, not in bot memory. Exact integer cents are used. Discord retries of the same interaction do not create a second expense. Receipt references add protection across distinct commands. Voiding and creation are transactional with audit records; audit failure rolls back the corresponding write.

Back up the database normally. Redeploys do not reset the ledger. This source was tested against a local PostgreSQL-compatible database and mocked Discord interactions; no live Discord commands, payments, keys, emails or production records were changed. After deploying, record a small clearly labeled test expense, run `/dashboard period:all`, verify the decrease, then `/voidexpense` it and verify the profit is restored.
