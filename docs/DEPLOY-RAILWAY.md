# Deploying Our 52 to Railway

Railway's auto-builder (Railpack) can't build this repo directly — it's a **pnpm
monorepo with two packages and no single root start command**, which is exactly
the `✖ No start command detected` error. The fix is to run each piece as its own
Railway **service built from the existing Dockerfiles**, using the `railway.*.json`
config files in the repo root.

You deploy **3–4 services** in one Railway project:

| Service   | Config file (set as the service's Config Path) | Public domain? |
|-----------|------------------------------------------------|----------------|
| Postgres  | (Railway managed database — add from the UI)   | no             |
| **api**   | `railway.server.json`                          | optional       |
| **web**   | `railway.web.json`                             | **yes** ← the app URL |
| worker    | `railway.worker.json` (optional — scheduling/WhatsApp) | no     |

Each config file pins `builder: DOCKERFILE`, so Railpack is bypassed.

---

## Steps

### 1. Postgres
In the project: **New → Database → PostgreSQL**. It exposes a `DATABASE_URL`.

### 2. api service
- **New → GitHub Repo** → pick this repo.
- Settings → **Config-as-code / Railway Config File** → set path to `railway.server.json`.
- Settings → Networking → set the service **PORT variable to `4000`** (so internal
  networking is deterministic — the API binds `process.env.PORT`).
- Variables:
  ```
  DATABASE_URL = ${{Postgres.DATABASE_URL}}
  PORT         = 4000
  NODE_ENV     = production
  DEMO_MODE    = false
  SESSION_SECRET = <a long random string>
  APP_BASE_URL = https://<your-web-domain>        # fill after step 3
  CORS_ORIGINS = https://<your-web-domain>        # fill after step 3
  TMDB_API_KEY = <your key>
  ANTHROPIC_API_KEY = <your key>                  # optional (smart import + emojis)
  ```
- The `startCommand` runs `prisma migrate deploy` then starts the API, and Railway
  health-checks `/api/health`.

### 3. web service
- **New → GitHub Repo** → same repo.
- Settings → Config File → `railway.web.json`.
- Settings → Networking → **Generate Domain** → this URL is your app. *(Generating
  this domain is what turns "Unexposed service" into a live URL.)*
- Variables:
  ```
  API_UPSTREAM = ${{api.RAILWAY_PRIVATE_DOMAIN}}:4000
  ```
  (nginx proxies `/api` to the api service over Railway's private network; SSE is
  already configured to stay unbuffered.)
- Go back to the **api** service and set `APP_BASE_URL` and `CORS_ORIGINS` to the web
  domain from this step, then redeploy api.

### 4. worker service (optional)
Only needed for **automatic** weekly picks + reminders (manual spinning works without it).
- Same repo, Config File → `railway.worker.json`.
- Give it the same `DATABASE_URL` (and any WhatsApp/Resend/Anthropic vars you use).
- No domain.

---

## Why it was failing
- **"No start command detected"** — Railpack tried to build the workspace root. The
  `railway.*.json` files switch each service to its Dockerfile build.
- **"Unexposed service"** — a service has no public URL until you **Generate Domain**,
  and the container must listen on Railway's injected `$PORT`. The web image now binds
  `$PORT` (was hardcoded to `80`); the api already used `$PORT`.

## Local dev / docker-compose still works
`docker compose up --build` is unchanged: the web image defaults to `PORT=80` and
`API_UPSTREAM=server:4000` when those env vars aren't set.
