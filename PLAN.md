# Our 52 — Project Context & Handoff (PLAN.md)

> Single-file context so you can clear memory and pick this up cold.
> Last updated: 2026-09-07.

---

## 1. What this is

**Our 52** is a private **couples activity roulette**. Each couple has a shared,
isolated space with two collections by default — **Dates** and **Movies** — fills
them with ideas, and every week spins a **CS:GO-style "case opening" carousel** to
pick one activity. You can reroll, mark it done, browse history, add a pick to your
calendars, and (optionally) drive it all from WhatsApp with 🔄 / ✅ / 👍 reactions.

The couple is **Teresa & Matisse**. The look is a warm, romantic **"fun love"**
theme (sunset/berry tones, no blue) with a per-person accent colour.

**Status: LIVE on Railway, running, tested.** 72 server tests pass; web build + server
typecheck are green. **Live URL → https://52-weeks-random-selector-production.up.railway.app**

**Latest session (2026-09-07, branch `fix/bug-hunt-gate-and-whatsapp`):**
- **Mandatory bug-review gate CLEARED.** The system-wide review (41 agents, adversarially
  verified) surfaced **29 confirmed findings (6 high / 13 med / 10 low)** — all fixed.
  Highlights: auto-select no longer permanently skips a week on an empty pool (claim-before-work
  removed; unique(periodId) handles concurrency); notify JobRun rolls back on enqueue failure;
  `notifyInstant` off-by-one fixed; ghost-result guards on `markCompleted` + `deleteMany`;
  movie one-copy invariant on restore/update; calendar invite atomic claim (no dup emails);
  RFC-5545 ICS line folding; OSM shared deadline + bounded/TTL geocode cache + 400 on bad
  category; AI-match token budget; Dockerfile `NODE_ENV=production` (Secure cookie) +
  `WHATSAPP_SESSION_DIR=/data/whatsapp`; web spin no longer hangs on "Choosing…".
- **Login security → shared passcode.** One-tap Teresa/Matisse now enter via a passcode-gated
  `POST /api/auth/space-login` (no client password). `login()` rejects demo accounts; seeded
  password is env/random and never logged; `SPACE_PASSCODE` gates the picker on the public URL;
  demo sessions are revoked the instant `DEMO_MODE` flips off. `acceptInvitation` refuses a user
  already in another couple (no burned slot).
- **WhatsApp connection HARDENED (§10 items 2–4).** Reconnect with capped backoff+jitter;
  `reconcileOutbox` re-queues stranded uncertain/failed sends; worker `healConnections()`
  self-heals drifted sessions each tick; group-mode activation/authorization. Settings shows a
  LIVE connection banner + a one-tap **"Save & link WhatsApp"** (save details → connect → QR).
  **Only unverified step: real phone QR pairing** (needs `WHATSAPP_ENABLED=true` + a phone).

**Earlier session (2026-09-06, on `main`):**
- **Deployed to Railway as ONE service** — the Fastify API now serves the built web app as
  static files with SPA fallback (`@fastify/static` in `server.ts`), so one service + one
  domain + one Volume at `/data` hosts everything. The client uses relative `/api` paths →
  same origin, no proxy/CORS. Root `Dockerfile` (multi-stage: build web → server serves it);
  `DATABASE_URL=file:/data/our52.db`; `start:prod` runs migrate + seed on boot. The old
  two-service split (`Dockerfile.server` + nginx `Dockerfile.web`) is now local-compose only.
- **One-tap Teresa/Matisse login in production** — the login page leads with a two-person
  picker (each in their own accent); password login is secondary. Gated on `DEMO_MODE=true`
  (decoupled from `NODE_ENV`, since this is a private shared space). Both share one couple space.
- **One spin per week — the pick is LOCKED.** Whoever spins first (or the Sunday auto-spin)
  decides the week; it's final and identical for both. **Reroll is disabled** server-side
  (web + WhatsApp 🔄) and its button removed. The pick now **shows immediately on login**
  (no "reveal" click); the result card notes "picked automatically" for auto-spins.

**Earlier session (2026-09-06, merged via PR #1):**
- **Storage → SQLite** (single file, no DB service); worker runs **inline in the API**.
- **WhatsApp → Baileys** (no Chromium); reminders **opt-in behind activation**.
- **Pool fixes:** emptied pool no ghost pick; watched movies removable; complete retires one copy.

---

## 2. How to run / where to test

- **Repo → https://github.com/vansteenbergenmatisse/52-weeks-random-selector** (`main`).
  Secrets live only in the gitignored `apps/server/.env`; a fresh clone needs
  `cp .env.example apps/server/.env` + your `DATABASE_URL` / `TMDB_API_KEY` / `ANTHROPIC_API_KEY`.
- **Web app → http://localhost:5173**  ← test here
- **API → http://localhost:4000** (health: `/api/health`)

**Demo login** (dev / `DEMO_MODE=true` only): one-tap buttons for **🌸 Teresa** and
**🎨 Matisse** on the login screen (both password `12345`, same couple). Open two
windows/incognito to see live sync.

Restart the dev stack — the **scheduling worker now runs inline** in the API
(`RUN_WORKER` defaults true), so the API process does both:
```bash
pnpm --filter @our52/server dev        # API :4000 + inline worker (tsx watch)
pnpm --filter @our52/web dev           # web :5173
```
(A standalone worker still exists — `pnpm --filter @our52/server dev:worker` — but
isn't needed; set `RUN_WORKER=false` on the API if you run it separately.)

Full reproducible stack (fresh DB, migrations + seed run automatically):
```bash
cp .env.example .env       # set SESSION_SECRET etc.
docker compose up --build  # app → http://localhost:8080
```

**Local dev prerequisites (already set up):**
- **SQLite — no database server.** `DATABASE_URL=file:./dev.db` → `apps/server/prisma/dev.db`
  (created by `pnpm --filter @our52/server db:migrate:dev`). Tests use their own
  `prisma/test.db`, recreated each run by `test/globalSetup.ts`.
- `apps/server/.env` exists with `DATABASE_URL` and `TMDB_API_KEY` set (see §8).
- Docker compose (SQLite single-app + web) is written and builds pass; compose was
  not executed this session (validated by running the app directly on SQLite).

---

## 3. Tech stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | React 18 + TS + Vite + Tailwind v3, React Query, React Router |
| Backend   | Node + TS via **tsx** (no compile step), Fastify, Zod |
| DB        | **SQLite** (single file) + **Prisma** (migrations + typed client) |
| Worker    | Scheduling + WhatsApp — runs **inline in the API** (`RUN_WORKER`, default true) |
| Realtime  | Server-Sent Events (`/api/events`), couple-scoped |
| Movies    | **TMDB API** — instant (typeahead) search, browse/discover, posters, ratings, IMDb ids (**key set**) |
| Places    | **OpenStreetMap** — Nominatim geocode + Overpass POI search for date discovery (**free, keyless**) |
| Emoji     | Auto-pick for date ideas via Claude (optional key; keyword fallback) |
| WhatsApp  | **Baileys** (unofficial, free, no browser) — **optional**, currently fixture; **opt-in**, gated behind activation |
| Calendar  | `.ics` invites emailed via **Resend** — **optional**, dormant until keyed |
| Tests     | Vitest (unit/integration, real DB) |
| Delivery  | Docker Compose (local); **Railway** via `railway.*.json` + Dockerfiles (see `docs/DEPLOY-RAILWAY.md`) |

Package manager: **pnpm workspace** (`apps/server`, `apps/web`). The server runs
via `tsx` in dev *and* prod. Relative imports use `.js` extensions. The app runs
fully without the optional keys — each feature degrades gracefully.

---

## 4. Repository layout

```
apps/
  server/
    prisma/
      schema.prisma               # data model (source of truth)
      migrations/                 # init, outbound_chatid, location_emoji_calendar, movie_imdb_id, entry_cost_prep
      seed.ts                     # idempotent Teresa & Matisse couple + example ideas
    scripts/
      backfill-movie-art.ts       # one-off: fill posters/IMDb for pre-key movies
    src/
      app/
        index.ts / worker.ts      # API + worker entries
        server.ts                 # Fastify build + route registration
        http.ts                   # auth helpers, zod parse, error mapping
        routes/                   # THIN handlers
          auth / collections / entries / results / movies / places / whatsapp / calendar / events
      features/
        auth/service.ts
        collections/service.ts
        entries/
          service.ts              # CRUD, bulk import, location, auto-emoji + IMDb lookup on add
          emoji.ts                # ★ Claude emoji pick + keyword fallback
        selection/service.ts      # ★ CORE: spin/reroll/complete, immutable snapshots, read models
        scheduling/worker.ts      # ★ tick(): auto-select + notify + calendar prompt, JobRun-idempotent
        movies/tmdb.ts            # ★ search + discover + genres + external_ids (IMDb), key-aware
        places/osm.ts             # ★ Nominatim geocode + Overpass POI search (free); category→tag map, mirror fallback
        movies/aiMatch.ts         # ★ Claude picks the right film from TMDB candidates (import matching); heuristic fallback
        calendar/
          ics.ts                  # ★ dependency-free .ics builder
          service.ts              # ★ config, Resend send, 👍 booking, prompt enqueue
        whatsapp/                 # adapter / baileysAdapter / manager (★ activation gate) / commands (★ + 👍) / outbox / format
      platform/                   # db, config/env, logger, security/crypto, realtime/bus, ai/claude.ts (shared Claude client)
      shared/                     # time.ts (★ DST math), errors.ts
    test/                         # selection, auth, scheduling, worker, whatsapp, emoji, calendar, places, movies, entries
  web/
    src/
      app/App.tsx                 # routes: /login, /invite/:token, /app, /app/pool; sets per-user theme
      features/
        auth/                     # useAuth, AuthPage (one-tap Teresa/Matisse), InvitePage, InviteDialog
        roulette/
          RoulettePage.tsx        # ★ shell: tabs, stage, spin, result, calendar action, nav to pool
          Carousel.tsx            # ★ arched carousel + long ease-out spin
          ResultPanel.tsx         # result + reroll/complete/add-to-calendar + IMDb link
          hooks.ts                # React Query hooks (entries, result, whatsapp, calendar, bulk import)
        entries/
          PoolPage.tsx            # ★ /app/pool — ideas grid, add, import
          IdeaGrid.tsx            # cards (emoji or poster) + 📍 location + 💲cost/🎒prep + IMDb link
          EntryDialog.tsx         # add/edit; movies use MoviePicker; dates use PlaceFinder + auto-emoji; location/cost/prep
          MoviePicker.tsx         # ★ Netflix-style browse + live debounced typeahead search (AbortController)
          PlaceFinder.tsx         # ★ live debounced OSM place search by area + category → fills title/location
          ImportDialog.tsx        # ★ Excel/CSV bulk import; movies get a per-row TMDB match+review step first
          ImportMovieRow.tsx      # ★ one reviewable import row: suggested match + inline search to correct it
          ProgressRow.tsx
        settings/
          SettingsDialog.tsx      # ★ per-collection schedule + WhatsApp reminders + calendar config
          countries.ts            # country dial-code list + splitDial() for the prefix picker
        history/ whatsapp/(WhatsAppDialog unused now) 
      components/ui/ (Dialog, Toggle, Wordmark)
      platform/api/client.ts · platform/realtime/useLiveSync.ts
      shared/types.ts
      styles/index.css            # ★ warm theme tokens + per-user --accent vars
    tailwind.config.js            # ★ warm palette (no blue), accent via CSS var
    e2e/main-flow.spec.ts (teresa/matisse) · nginx.conf
docs/visual-qa/ · docs/DEPLOY-RAILWAY.md · Dockerfile.* · apps/web/nginx.conf.template + docker-entrypoint.sh
railway.json (api, auto-detected) + railway.web/worker.json (set Config Path) · docker-compose.yml · .env.example · README.md · PLAN.md
```

`★` = files carrying the important/subtle logic.

---

## 5. Data model (Prisma)

`User, Session, Couple, Membership, Invitation, Collection, Entry, WeeklyPeriod,
WeeklyResult, ResultRevision, WhatsAppSession, WhatsAppConfig, CalendarConfig,
OutboundMessage, ProcessedInboundEvent, JobRun`.

Invariants & notable fields:
- `Membership @@unique(coupleId,userId)`; two-person cap in a serializable txn.
- `Collection`: per-collection schedule (weekday/time/**IANA tz**), `autoSelect`,
  notify settings, `targetPerPerson` (26), `cycleIndex/cycleStartDate`.
- `Entry`: `location`, **`cost`** (free/$/$$/$$$), **`prep`** (what to prepare), movie metadata (`tmdbId`, **`imdbId`**, poster/backdrop, year).
- `WeeklyPeriod @@unique(collectionId,cycleIndex,weekIndex)` — 1..52 activity weeks.
- `WeeklyResult @unique(periodId)` — one canonical result per period;
  `currentRevisionNumber` = optimistic lock for rerolls; **`calendarInvitedAt`** = calendar idempotency.
- `ResultRevision` — **immutable snapshot** per draw/reroll (title/emoji/contributor/
  artwork/**location**/**imdbId**), so editing an entry never rewrites history.
- `WhatsAppConfig` — delivery mode + recipient numbers (E.164, JSON array).
- `CalendarConfig` — per couple: `enabled`, `emails` (JSON), `durationMins`.
- `OutboundMessage` — WhatsApp outbox (kinds: result/reminder/reroll/test/**calendar_prompt**),
  tracks `waMessageId` + status for reconciliation.
- `ProcessedInboundEvent @unique(eventKey)` — inbound dedup ledger.
- `JobRun @unique(jobKey)` — worker idempotency (`select:<periodId>`, `notify:<periodId>`).

---

## 6. Core behaviours (the subtle parts)

**Selection** (`features/selection/service.ts`): server picks + persists the winner
**before** the client animates; uniform `crypto.randomInt`. **One spin per week — the pick
is LOCKED once decided** (first spin or the Sunday auto-spin); concurrent spins converge on
ONE result via `unique(periodId)`, and `reroll()` is a **no-op returning `reason:"locked"`**
(reroll is disabled for both web and WhatsApp 🔄). `markCompleted` sets `completedAt` **and**
flips the picked entry to `completed` (**only that copy** — other copies of the same
movie stay for a re-watch). Selected/completed entries are excluded from draws.
**Pool is the source of truth:** a weekly result only shows if its pick is still a
live pool entry — if the pick was removed, `getCurrentState`/`spin` treat the week as
re-spinnable (spin discards the stale result and draws fresh), so an emptied pool never
replays a "ghost" pick. History reads immutable snapshots, so it's untouched.

**Carousel** (`Carousel.tsx`): launches at full speed (long fixed runway) and eases
out smoothly into the winner (`easeOutQuint`, ~7s). Winner is server-decided; odds
unchanged.

**Auto-emoji** (`entries/emoji.ts`): date ideas get an emoji picked on save — Claude
(Haiku) when `ANTHROPIC_API_KEY` is set, else a keyword map (→ ❤️ fallback). Never
blocks or fails (timeout + fallback). Movies use poster art, not emoji.

**Movies** (`movies/tmdb.ts` + `MoviePicker.tsx`): browse Top rated / Trending /
Popular, filter by genre, see ⭐ ratings, or **live typeahead search** — the box fires a
debounced TMDB query ~250ms after you stop typing (Netflix-style), with an
`AbortController` cancelling the previous in-flight request so results never race.
Empty box → the browse feed returns. Picking a movie fills title/year/poster and the
server looks up its **IMDb id** for the card link. **Bulk movie import** (`ImportDialog` +
`POST /api/movies/match`) first detects **which column holds the titles** — a recognised
Title/Movie header is used directly; otherwise `POST /api/movies/detect-columns` has Claude
read the sheet layout so an index/number column ("1, 2, 3…") is never treated as a title
(text-column heuristic + numeric filter as fallback). Then it gathers TMDB candidates per
row and lets **Claude pick the correct film** (`movies/aiMatch.ts` — handles typos, translations, missing years;
validates the id is a real candidate, else null); falls back to a title/year heuristic
(`pickBestMatch`) when `ANTHROPIC_API_KEY` is unset or the call fails. The review step is a
**checklist**: confident matches start ticked, no-match rows start unticked, each row can
be corrected via inline live search or set to "import as text", and **nothing is written
until you click "Add N selected"** — only ticked rows import (posters + IMDb ids resolved
in a batch). Unticked rows are skipped entirely.

**Pool management** (`PoolPage` + `IdeaGrid` + `ProgressRow` + entries service): each partner's
count shows how many are **currently in the pool** (available only — selected/completed excluded,
so the number matches the visible cards). Deletion is **one-tap, no confirm**, and **either
partner may remove any** movie/idea (e.g. "we watched it") — soft-delete backs an **Undo** toast
(`POST /api/entries/:id/restore`). Editing stays owner-only. The grid also shows a **"✓ Watched"
section** for completed movies so either partner can still delete them (otherwise a completed pick
lingers invisibly and could resurface as a ghost). Each **movie is unique** in a collection (dedup
by `tmdbId` on add + bulk import; adding a dupe returns the existing entry). Marking a movie
**completed retires only that picked copy** — duplicates stay in the pool for a re-watch.

**Places / date discovery** (`places/osm.ts` + `PlaceFinder.tsx`): for date ideas, type
an area ("Manhattan, New York") and pick a category (culture / food / drinks / adventure
/ outdoors / wellness). **Nominatim** geocodes the area, then **Overpass** returns named
POIs within ~3km — same debounced-typeahead pattern as movies. Picking one fills the
idea's title + location. Free and keyless; category→OSM-tag map collapses same-key tags
into one regex clause per key for a cheap query, and search falls back across Overpass
mirrors (kumi → overpass-api.de → private.coffee) when one is overloaded. Date ideas also
carry an optional **cost** band and a **what-to-prepare** note (shown on pool cards).

**Scheduling** (`shared/time.ts` + `scheduling/worker.ts`): per-collection weekday/
time, DST-aware via Luxon; `tick()` auto-selects (if due) and notifies (saved result
or a reminder), both `JobRun`-guarded; only the CURRENT period is processed.

**WhatsApp** (`features/whatsapp/*`): the **paired phone is the sender** (a
"userbot" via **Baileys** — pure WebSocket, no Chromium; `baileysAdapter.ts` implements the
library-agnostic `WhatsAppAdapter`). Shared selection logic drives web + WhatsApp. Inbound
🔄/✅ reactions and REROLL/DONE replies are deduped, authorised, and guarded against
superseded results. Outbox reconciles uncertain sends. **Currently the fixture
adapter is active** (`WHATSAPP_ENABLED=false`) — messages are recorded, not delivered.
Recipient numbers require a country code (E.164); Settings has a country-prefix picker.
**Reminders are opt-in**: they never fire until the couple completes a one-time **activation**
(phone recipient + linked WhatsApp session + calendar email). The reminder toggle is disabled
until then (Settings shows a 3-step checklist); the worker + `updateCollection` both enforce
the gate (`whatsapp.isActivated`), so nothing sends before setup is complete.

**Calendar** (`features/calendar/*`): after a weekly pick, a second "📅 add to
calendar?" WhatsApp message is enqueued (when configured); a **👍** on it — or the
"Add to calendar" button in the app — emails an `.ics` invite (via Resend) to both
partners. Idempotent per pick (`calendarInvitedAt`). Event time = the collection's
scheduled slot; location included.

**Theme**: warm "fun love" palette (no blue) in `tailwind.config.js` + `styles/index.css`;
`--accent` is a CSS variable overridden per logged-in user (Teresa → rose, Matisse →
coral) via `data-user` on `<html>` (set in `App.tsx`).

**Live sync**: mutations `publish()` to an in-process bus → `/api/events` SSE → web
invalidates React Query. Fallback: refetch on window focus.

---

## 7. Tests & verification

```bash
pnpm --filter @our52/server test          # 72 tests (SQLite; schema auto-created by globalSetup)
pnpm --filter @our52/server exec tsc --noEmit -p tsconfig.json   # server typecheck
pnpm --filter @our52/web build            # tsc + vite build
```
Coverage: selection (spin/reveal/reroll/exclusion/uniformity/concurrency, completion),
auth & couple isolation, invitation two-person cap, DST scheduling, worker restart
idempotency + **result message contains the exact picked title (revision-tagged)**,
WhatsApp event dedup, **auto-emoji fallback**, **calendar .ics build + prompt enqueue**,
**OSM place search** (query builder + response mapper), **movie import** (best-match +
AI-verdict reconcile + column-detection sanitizer + bulk poster/IMDb persistence),
**entries** (either-partner delete + restore + couple isolation, available-only progress
count, movie dedup on add/import, completion retiring only the picked copy), empty-pool/removed-pick ghost guard, and WhatsApp reminder activation gating.

The test DB (`apps/server/prisma/test.db`) is created fresh each run by
`test/globalSetup.ts` (`prisma db push`), so there's no manual migrate step.

---

## 8. Environment variables (see `.env.example`)

Core: `DATABASE_URL` (SQLite `file:` URL — `file:./dev.db` locally, `file:/data/our52.db`
on a Railway Volume), `PORT, APP_BASE_URL, SESSION_SECRET, CORS_ORIGINS, DEMO_MODE,
NODE_ENV, DEFAULT_TIMEZONE/WEEKDAY/TIME, WORKER_TICK_SECONDS, RUN_WORKER` (default true —
inline worker), `VITE_API_BASE`.

Integrations (all optional; features degrade gracefully):
- `TMDB_API_KEY` — **SET** (v4 read-access token). Movie search/discover/posters/IMDb live.
- `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, default Haiku 4.5) — **SET** → smart Excel movie matching + nicer auto-emojis. Unset → keyword-emoji + string-match fallback.
- `RESEND_API_KEY` + `CALENDAR_FROM_EMAIL` — *not set* → calendar invites dormant.
- `WHATSAPP_ENABLED` — **false** → fixture adapter (no real delivery). `WHATSAPP_SESSION_DIR` (Baileys multi-file auth). *(No Chrome path any more — Baileys needs no browser.)*

In production set a real `SESSION_SECRET`. **`DEMO_MODE=true` is intentionally ON in prod**
(private shared space) so the one-tap Teresa/Matisse picker works; the demo gate is decoupled
from `NODE_ENV` (`demoEnabled = env.DEMO_MODE`). **Set `SPACE_PASSCODE`** in prod so the picker
requires a shared secret (a stranger with the URL can't tap straight in); the seeded accounts have
no client-usable password and sign in only via `POST /api/auth/space-login`. `DEMO_PASSWORD` is
optional (a strong random one is generated on first seed otherwise, never logged).

---

## 9. Known gaps / what's NOT verified

- **WhatsApp live pairing is the ONE unverified path.** The Baileys adapter now has capped
  backoff+jitter reconnect, outbox reconciliation, and a per-tick `healConnections()` self-heal;
  the container defaults `WHATSAPP_SESSION_DIR=/data/whatsapp` so creds persist on the Volume;
  Settings has a live status banner + one-tap "Save & link WhatsApp". **Still unverified:** an
  actual QR pairing/send with a real phone (needs `WHATSAPP_ENABLED=true` on the server and
  someone to scan). Unofficial client — can still drop; the reconnect/heal logic is untested
  against a live socket.
- **SMS is not implemented** (WhatsApp-only, by choice).
- **Calendar delivery unverified** — needs `RESEND_API_KEY` + both emails in Settings.
  The `.ics` build + 👍/button trigger + idempotency are coded and tested.
- **Railway deploy DONE** ✅ — live at the URL in §1 as **one service** (API serves the web
  app) built from the root `Dockerfile`, with a Volume at `/data`,
  `DATABASE_URL=file:/data/our52.db`, and `SESSION_SECRET`/`APP_BASE_URL`/`CORS_ORIGINS`/keys
  set. Kept at **one replica** (SQLite + in-process live-sync). `start:prod` migrates + seeds
  on boot; verified live (`/api/health` 200, login + locked pick + shared space all work).
- **Verified on the live deploy** ✅ — one-tap login, collections, spin → locked pick shown
  on login, inline worker, same-origin `/api` + SSE all work. Live WhatsApp pairing is the
  only remaining unverified core path (see the WhatsApp gap above).
- **Anthropic live** ✅ — `ANTHROPIC_API_KEY` is set; smart Excel movie matching, column
  detection, and auto-emoji are active and verified.

---

## 10. Suggested next steps

> Deploy is done (§1). The bug-review gate is CLEARED and the WhatsApp connection is hardened
> in code. The one remaining WhatsApp step needs a real phone.

### ✅ MANDATORY bug review — DONE
The system-wide bug hunt ran (41 agents, adversarially verified) → **29 confirmed findings
(6 high / 13 med / 10 low), all fixed** this session with 7 new regression tests. See the
"Latest session" note in §1 for the highlight list.

### WhatsApp connection — items 2–4 DONE; item 1 needs a phone
1. **Real connection (ONLY remaining step)** — set `WHATSAPP_ENABLED=true` on the server, open
   Settings → "Save & link WhatsApp", scan the QR with the phone, and confirm a live send. Creds
   persist under `WHATSAPP_SESSION_DIR=/data/whatsapp` (container default) across redeploys. This
   can't be verified without a phone.
2. ✅ **Automatic disconnects** — capped exponential backoff + jitter reconnect in
   `baileysAdapter`; keeps retrying after a failed attempt. Per-tick `healConnections()` reconnects
   any drifted session and drains the outbox (`reconcileOutbox`).
3. ✅ **Reconnect prompt** — Settings shows a live banner (off / linked / scan-QR / connecting /
   dropped→reconnect). **Scope is reminders-only**: spin, pool, calendar all keep working without
   WhatsApp; the reminder toggle stays gated behind an active connection.
4. ✅ **Activation flow** — one-tap **"Save & link WhatsApp"** saves numbers + calendar emails,
   then immediately starts the connection and surfaces the QR; reminders unlock once linked.

### Later / optional
5. Add `RESEND_API_KEY` + both emails → verify a real calendar invite lands.
6. `docker compose up --build` smoke test (validates the local two-service compose path).
7. Custom collections UI (backend supports them; add a "＋ New collection" tab entry).
8. Import personal IMDb ratings via CSV; multi-instance realtime (swap in-process bus for
   Postgres LISTEN/NOTIFY or Redis) only if scaling past one process.
