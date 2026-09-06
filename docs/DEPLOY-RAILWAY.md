# Deploying Our 52 to Railway

Our 52 stores everything in a **single SQLite file** — there is no database
service to run. You deploy **two services** in one Railway project:

| Service | Config file | Config Path needed? | Public domain? |
|---------|-------------|---------------------|----------------|
| **app** | `railway.json` | **no** (auto-detected) | optional |
| **web** | `railway.web.json` | **yes** → set the path | **yes** ← the app URL |

> **Why `railway.json` for the app:** Railway only auto-detects a config file
> named `railway.json`/`railway.toml`. Custom names like `railway.web.json` are
> ignored unless you set the service's **Config Path**, so the web service must
> point at it explicitly (otherwise it silently falls back to Railpack →
> `No start command detected`).

The **app** service runs the API, the scheduling worker (inline — `RUN_WORKER`
defaults true), and applies migrations + seeds the couple on start. Its SQLite
file lives on a **Volume** so it survives redeploys.

> ⚠️ Keep the app service at **one replica**. SQLite is a single file on one
> Volume, and the live-sync bus is in-process — neither works across replicas.
> (Two people is nowhere near needing more than one instance.)

---

## Steps

### 1. app service
- **New → GitHub Repo** → pick this repo. Railway auto-detects `railway.json`
  and builds `Dockerfile.server` — no builder config needed.
- **Add a Volume** (service → **+ Volume**) mounted at **`/data`**. This is
  where the SQLite file and WhatsApp session persist.
- Settings → Networking → set the **PORT variable to `4000`**.
- Variables:
  ```
  DATABASE_URL = file:/data/our52.db
  PORT         = 4000
  NODE_ENV     = production
  DEMO_MODE    = false
  SESSION_SECRET = <a long random string>
  APP_BASE_URL = https://<your-web-domain>        # fill after step 2
  CORS_ORIGINS = https://<your-web-domain>        # fill after step 2
  TMDB_API_KEY = <your key>
  ANTHROPIC_API_KEY = <your key>                  # optional
  WHATSAPP_SESSION_DIR = /data/whatsapp           # only if you enable WhatsApp
  ```
- On boot the start command runs `prisma migrate deploy` → seed (idempotent) →
  API, and Railway health-checks `/api/health`.

### 2. web service
- **New → GitHub Repo** → same repo.
- Settings → **Config Path** → `railway.web.json` (required — see the note above).
- Settings → Networking → **Generate Domain** → this URL is your app.
- Variables:
  ```
  API_UPSTREAM = ${{app.RAILWAY_PRIVATE_DOMAIN}}:4000
  ```
  (nginx proxies `/api` to the app over Railway's private network; SSE stays
  unbuffered.) If you named the app service something other than `app`, match it
  here.
- Go back to the **app** service, set `APP_BASE_URL` and `CORS_ORIGINS` to this
  domain, and redeploy the app.

### 3. Log in
`DEMO_MODE=false` disables the one-tap demo buttons; the seed creates the couple,
so sign in with **`teresa` / `12345`** or **`matisse` / `12345`** (change the
passwords afterwards in the app if you like).

---

## Deterministic alternative (CLI)
If a service ever falls back to Railpack, force the Dockerfile builder directly:

```bash
railway environment edit --service-config web build.builder DOCKERFILE
railway environment edit --service-config web build.dockerfilePath Dockerfile.web
```

The **app** service reads `railway.json` automatically.

## Local dev / docker-compose
`docker compose up --build` runs the same two-service stack with the SQLite file
on a local volume (`our52_data`) — no Postgres. App → http://localhost:8080.

## Backups
The entire database is one file: `/data/our52.db` on the app Volume. Copy it off
(Railway shell or a volume snapshot) to back up; drop it back to restore.
