# v0.12.1 validation

- npm ci with the included lockfile and npm run check passed for both packages.
- Bot: 58 automated tests passed.
- Backend: 77 automated tests passed, including real HTTP routes with a local PostgreSQL-compatible database.
- An additional development integration check drove the actual bot handler through the actual backend HTTP route and browsed all 26 fixture keys across six pages.
- Website OAuth linking is tested using synthetic Discord responses; the newly confirmed website key is visible through staff key lookup.
- Legacy key/device searches, customer recovery, ticket/payment flows, sales/expenses and website stock regression tests pass.
- No live Discord command, customer key, production database or Railway deployment was changed during development. Deploy and run the controlled test in KEYINFO-SETUP.md.
