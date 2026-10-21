# Website key stock — Quilted Tweaks 0.10.0

Generate QT license keys in bulk without assigning a Discord customer. Every key still uses the same existing one-PC hardware lock and activation protocol.

## Deploy

1. Replace the existing backend folder/repository with the enclosed backend files. Keep PostgreSQL and all current secrets/variables. Redeploy the backend first.
2. Wait until `/ready` reports backend `0.10.0` and database `ready`. Migration `011_qt_website_key_batches.sql` runs automatically. It permits unlinked website keys, adds batch tracking, and preserves existing licenses, owners, device bindings, and activation sessions.
3. Replace the existing bot folder/repository with the enclosed `discord-bot` files and redeploy. Keep the current bot variables and Railway root directory. New slash commands register on startup in the configured server.
4. No new required variable is needed. Bot `BACKEND_ADMIN_KEY` must still match backend `ADMIN_API_KEY`. Keep `LICENSE_KEY_ENCRYPTION_KEY`, `JWT_SECRET`, and `DEVICE_HASH_PEPPER` unchanged.

The existing QT Premium Utility app can activate these keys without a new EXE: key format, product identifier, activation endpoints, tokens, and device-binding behavior are unchanged.

## Generate a batch

```
/genwebsitekeys count:100 plan:Lifetime note:SellAuth lifetime stock
```

Use the offered plan choice. The command supports 1–1000 keys per batch. To create just one unlinked website key, use `count:1`.

For timed stock, select **Timed (1–30 days)** and set the duration:

```
/genwebsitekeys count:100 plan:Timed trial_days:30 note:SellAuth 30-day stock
```

Timed keys use the existing internal `trial` plan but behave as paid timed access: no clock starts while they sit in stock. Their duration starts on their first successful app activation. Lifetime keys do not expire.

The bot replies privately with the batch ID and a TXT attachment. It contains exactly one key per line, with no headings, customer names, markdown, or byte-order mark. Import the file contents into your website/SellAuth key or serial stock, with one line delivered per purchase. Generate separate batches for each plan/duration you sell.

Only configured owners/admin-role users can generate, list, or export website stock. A Discord customer is never requested, and no keys are sent to customers by these commands.

## One PC per key

- The first successful activation binds the key to that PC's device fingerprint.
- Another PC is rejected with `QT-HWID-LOCKED`.
- Concurrent first-activation requests from different PCs cannot claim the same key twice.
- The existing staff `/resetdevices` command can release a binding when you approve a hardware change. Resetting does not restart a timed key's duration.
- Revoking, restoring, reissuing, looking up, extending, and deleting keys work through the existing commands. Reissuing an activated key keeps its hardware binding and invalidates the old key.
- Unlinked website stock is not listed by a customer's `/whatsmykey`. After the buyer completes Discord sign-in and confirms linking in QT v3.0.0, their website key appears in customer recovery and staff `/keyinfo user:@customer`. Staff can still find unlinked stock by key or device ID. Deliberate staff transfers remain available through `/transferkey`.
- Existing `/genkey user:...` remains the same Discord-linked generator.

## Recover an export

```
/websitebatches
/exportwebsitekeys batch_id:<batch ID>
```

Batches and encrypted keys are stored in PostgreSQL and survive bot/backend restarts. Exports do not generate new keys. Re-delivery of the same Discord generation interaction returns the saved batch instead of minting another one. If an attachment or request times out, check `/websitebatches` before generating a replacement batch.

By default, export only includes active, unactivated, unlinked keys that have not expired. Keys that were activated and then reset are excluded too. **“Unused” means not activated; it does not mean unsold.** A key delivered by your shop but not yet activated can still appear in an export. The shop controls its stock/delivery records. Import each key only once, and do not reimport an entire recovered batch on top of stock you already uploaded.

For full administrative recovery, `/exportwebsitekeys batch_id:... unused_only:false` includes every remaining current key in the batch, including activated, revoked, or linked keys. It is labeled accordingly and is not suitable as fresh shop stock. Deleted keys cannot be recovered from a batch.

Batch generation/export is audited without putting raw keys into audit details. Exports are available only through authenticated backend administration and private bot replies. Keep the TXT stock file private until importing it.

## Existing features

Sales commands, product management, dashboard PNGs, ticket/payment reminders, customer-linked keys, force-update controls, and recovery commands are retained. Generating/importing key inventory does not record a sale or verify a payment. `/confirm` still records manual paid sales; automatic SellAuth order synchronization is a separate integration.

## Checks

`npm ci`, `npm run check`, and `npm test` in both folders. See `VALIDATION-0.10.0.md` for the results and limits. Live Discord command registration and Railway deployment require your configured services; they were not run from this workspace.
