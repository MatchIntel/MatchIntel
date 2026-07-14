# Security

- Plain license keys are returned once and only SHA-256 hashes are stored.
- Device identifiers are peppered and hashed before database storage.
- Short-lived access tokens and rotating hashed refresh tokens are device-bound.
- Provider secrets stay in Railway environment variables.
- Admin routes require `X-Admin-Key`.
- Discord commands are restricted to configured owner IDs.
- Revocation invalidates refresh tokens; access tokens expire after the short configured lifetime.
- Do not commit `.env` or paste secrets into `client/js/config.js`.
