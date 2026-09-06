# Deploying Our 52 to Railway

Railway's auto-builder (Railpack) can't build this repo directly — it's a **pnpm
monorepo with two packages and no single root start command**, which is exactly
the `✖ No start command detected` error. The fix is to run each piece as its own
Railway **service built from the existing Dockerfiles**.

> **The gotcha that causes the Railpack error:** Railway only *auto-detects* a
> config file named **`railway.json`** (or `railway.toml`) at the repo root.
> Custom names like `railway.web.json` are **ignored** unless you set that path in
> the service's **Config Path** field. If it's not set, the service silently falls
> back to Railpack → `No start command detected`.

So the **api** config is named `railway.json` (auto-detected — nothing to configure).
The other two services use custom-named files and **must** have their Config Path set:

| Service   | Config file                       | Config Path needed?          | Public domain? |
|-----------|-----------------------------------|------------------------------|----------------|
| Postgres  | (Railway managed DB — add in UI)  | —                            | no             |
| **api**   | `railway.json`                    | **no** (auto-detected)       | optional       |
| **web**   | `railway.web.json`                | **yes** → set the path       | **yes** ← the app URL |
| worker    | `railway.worker.json` (optional)  | **yes** → set the path       | no             |

Each config file pins `builder: DOCKERFILE`, so Railpack is bypassed once it's read.

> ⚠️ Because `railway.json` is auto-detected, **any** service that doesn't have its
> Config Path set will build the *api* image (Dockerfile.server). Always set the
> web and worker services' Config Path so they build the right Dockerfile.

## Deterministic alternative (CLI) — if the Config Path field won't stick

Setting the builder directly on a service bypasses config-file detection entirely.
Link the project once (`railway link`), then per service:

```bash
railway environment edit --service-config web build.builder DOCKERFILE
railway environment edit --service-config web build.dockerfilePath Dockerfile.web
# worker:
railway environment edit --service-config worker build.builder DOCKERFILE
railway environment edit --service-config worker build.dockerfilePath Dockerfile.server
railway environment edit --service-config worker deploy.startCommand "pnpm start:worker"
```

The **api** service needs none of this — it reads `railway.json` automatically.

---

## Steps

### 1. Postgres
In the project: **New → Database → PostgreSQL**. It exposes a `DATABASE_URL`.

### 2. api service
- **New → GitHub Repo** → pick this repo.
- Nothing to configure for the builder: Railway auto-detects `railway.json` and
  builds `Dockerfile.server`. (No Config Path needed for this service.)
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
- **"No start command detected"** — Railpack tried to build the workspace root
  because no config file was being read. Railway only auto-detects a root
  **`railway.json`**; the old `railway.server.json` name was ignored unless its
  Config Path was set. Renaming the api config to `railway.json` makes it
  auto-detected, and the web/worker configs switch their services to Dockerfile
  builds once their Config Path is set (or via the CLI method above).
- **"Unexposed service"** — a service has no public URL until you **Generate Domain**,
  and the container must listen on Railway's injected `$PORT`. The web image now binds
  `$PORT` (was hardcoded to `80`); the api already used `$PORT`.

## Local dev / docker-compose still works
`docker compose up --build` is unchanged: the web image defaults to `PORT=80` and
`API_UPSTREAM=server:4000` when those env vars aren't set.
