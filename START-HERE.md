# MatchIntel setup

## What is included

```text
client/       Overwolf application
backend/      Railway API and PostgreSQL schema
discord-bot/ Railway Discord administration bot
scripts/      OPK packaging helper
docs/         deployment, testing and security notes
```

## 1. Deploy the backend to Railway

1. Upload this entire folder to a **private GitHub repository**.
2. Create a new Railway project.
3. Add **PostgreSQL** from `+ New`.
4. Add a service from your GitHub repository.
5. Set the service Root Directory to `/backend`.
6. In the service settings, set the Railway config file path to `/backend/railway.toml` if it is not detected automatically.
7. Add the variables shown in `backend/.env.example`.
8. Add a reference variable named `DATABASE_URL` pointing to the PostgreSQL service's `DATABASE_URL`.
9. Generate a public domain under Settings → Networking.
10. Open `https://YOUR-DOMAIN/health` and confirm it returns `status: ok`.

Generate `JWT_SECRET`, `ADMIN_API_KEY`, and `DEVICE_HASH_PEPPER` as separate random secrets. In PowerShell:

```powershell
[Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }))
```

## 2. Create your first key

Use the included CLI with Railway's externally accessible PostgreSQL URL:

```powershell
cd backend
npm install
$env:DATABASE_URL="YOUR_POSTGRES_PUBLIC_URL"
$env:JWT_SECRET="YOUR_JWT_SECRET"
$env:ADMIN_API_KEY="YOUR_ADMIN_API_KEY"
$env:DEVICE_HASH_PEPPER="YOUR_DEVICE_HASH_PEPPER"
npm run key:create -- --duration 30d --plan pro --devices 1
```

Supported durations: `12h`, `7d`, `4w`, `1m`, `1y`, and `lifetime`.

## 3. Point the Overwolf app at Railway

Edit `client/js/config.js`:

```javascript
window.MATCHINTEL_CONFIG = {
  backendUrl: "https://YOUR-BACKEND.up.railway.app"
};
```

Only the public backend URL belongs in the client. Never place database, admin, Discord, or provider secrets there.

## 4. Load MatchIntel into Overwolf

1. Install Overwolf and sign in.
2. Get your Overwolf account approved for unpacked development.
3. Open Overwolf Settings → About/Support → Development options.
4. Click **Load unpacked extension**.
5. Select the `client` folder containing `manifest.json`.
6. Start MatchIntel from the Overwolf dock.
7. Paste your MatchIntel license key.
8. Start Fortnite and enter a supported match.

The app asks Overwolf for `match`, `match_info`, `rank`, `team`, `me`, `phase`, and `gep_internal`. The Event Health panel preserves the newest raw payload so the mapping can be adjusted after a Fortnite update.

## 5. Deploy the Discord bot

1. Create a Discord application and bot.
2. Create a second Railway service from the same repository.
3. Set Root Directory to `/discord-bot` and config path to `/discord-bot/railway.toml`.
4. Add the variables from `discord-bot/.env.example`.
5. Invite the bot with `applications.commands` and bot permissions.

Commands:

- `/key-create`
- `/key-revoke`
- `/key-reset-devices`
- `/license-find`
- `/maintenance`
- `/system-status`

## 6. Build an OPK

```powershell
.\scripts\build-opk.ps1
```

The output is `artifacts/MatchIntel.opk`.

## Local backend testing

```powershell
cd backend
docker compose up -d
Copy-Item .env.example .env
npm install
npm run dev
```

Then open `http://localhost:8080/health`.
