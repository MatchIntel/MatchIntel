# v0.11.0 validation

- Backend syntax checks and all 58 backend tests pass.
- Bot syntax checks and all 49 bot tests pass.
- 107 automated tests total, including existing licensing, force-update, bulk website keys, ticket branding, access control, sales, and new expense behavior.
- New coverage exercises the production expense HTTP mount, integer-cent money calculations, same-interaction retries, duplicate receipt references, server isolation, invalid and future dates, archived-product expenses, transaction rollback on audit failure, voiding, period/product filters, expense-only losses, service reconstruction, and upgrade from all pre-existing migrations with retained sales/products.
- Bot tests cover private admin access, command schemas, exact API forwarding, safe bounded replies, missing-backend errors, generated PNG signatures/dimensions, loss and empty charts, escaped SVG text and omission of private receipt/description data.
- The 1400 x 1000 dashboard was rendered with demo data and visually inspected. No production Discord commands were registered or invoked, and no live financial transactions or database records were changed.

Deploy the backend first, wait for /ready version 0.11.0 and database ready, then deploy the bot. Keep the current PostgreSQL database and Railway variables. See SALES-SETUP.md.
