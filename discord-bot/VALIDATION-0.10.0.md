# Quilted Tweaks 0.10.0 validation

- Backend syntax checks and all 51 backend tests passed.
- Bot syntax checks and all 44 bot tests passed (95 tests total).
- Applied the full migration sequence 001 through 011 to a fresh PostgreSQL-compatible PGlite database.
- Issued and activated a real fixture Discord-linked license before migration 011, then verified that the original owner, binding, access token, and refresh path survived the migration.
- Generated 1000 distinct fixture keys in one atomic batch. Verified encrypted storage, null customer ownership, recoverable TXT ordering, idempotent retries, and absence of raw keys in audit details.
- Website keys used the existing activation/status/refresh protocol with appVersion 2.9.0, maxDevices 1, first-PC binding, second-PC rejection, and simultaneous competing-PC activation checks.
- Verified timed keys start their expiration only on first activation and retain that date across further activations, resets, and reissues. Existing revocation and session invalidation remain effective.
- Verified rollback on insertion/audit failure, permission restrictions, private Discord attachment payloads, exact one-key-per-line UTF-8 TXT with CRLF and no BOM, 1000-key export size, batch recovery, and explicit full-export warnings.
- Existing sales, product management, dashboard PNG rendering, licensing, tickets/payment safety, and force-update tests remained green.
- ZIP CRC, file/version/lockfile, schema, and module syntax checks passed. No runtime node_modules or live .env files are included.

Checks ran locally on Linux with Node 24 and PGlite. Dockerfiles still target Node 22. Live Railway deployment, Discord gateway slash-command registration/attachment delivery, a real Windows client session, and actual SellAuth stock import were not performed. The unchanged desktop wire protocol was exercised through the backend API tests.
