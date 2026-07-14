# Railway deployment

Create one Railway project with three services:

1. PostgreSQL
2. Backend from `/backend`
3. Discord bot from `/discord-bot`

For the backend, add `DATABASE_URL` as a Railway reference variable from PostgreSQL. Generate a public domain for the backend. Set the config file path to `/backend/railway.toml` when using a monorepo root directory.

The backend runs migrations automatically before starting. Use Railway's backup feature before distributing paid keys.
