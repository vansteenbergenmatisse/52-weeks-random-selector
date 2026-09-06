# Our 52 — Project Context & Handoff (PLAN.md)

> Single-file context so you can clear memory and pick this up cold.
> Last updated: 2026-09-06.

---

## 1. What this is

**Our 52** is a private **couples activity roulette**. Each couple has a shared,
isolated space with two collections by default — **Dates** and **Movies** — fills
them with ideas, and every week spins a **CS:GO-style "case opening" carousel** to
pick one activity. You can reroll, mark it done, browse history, add a pick to your
calendars, and (optionally) drive it all from WhatsApp with 🔄 / ✅ / 👍 reactions.

The couple is **Teresa & Matisse**. The look is a warm, romantic **"fun love"**
theme (sunset/berry tones, no blue) with a per-person accent colour.

**Status: complete, running, tested.** 64 server tests pass; web build + server
typecheck are green.

---

## 2. How to run / where to test

- **Web app → http://localhost:5173**  ← test here
- **API → http://localhost:4000** (health: `/api/health`)

**Demo login** (dev / `DEMO_MODE=true` only): one-tap buttons for **🌸 Teresa** and
**🎨 Matisse** on the login screen (both password `12345`, same couple). Open two
windows/incognito to see live sync.

Restart the dev stack — note the **worker is a separate process** (root `pnpm dev`
starts API + web only):
```bash
pnpm --filter @our52/server dev        # API :4000  (tsx watch)
pnpm --filter @our52/server dev:worker # scheduling + WhatsApp worker
pnpm --filter @our52/web dev           # web :5173
```

Full reproducible stack (fresh DB, migrations + seed run automatically):
```bash
cp .env.example .env       # set SESSION_SECRET etc.
docker compose up --build  # app → http://localhost:8080
```

**Local dev prerequisites (already set up):**
- Local PostgreSQL running; databases `our52_dev` (app) and `our52_test` (tests).
- `apps/server/.env` exists with `DATABASE_URL` and `TMDB_API_KEY` set (see §8).
- Docker compose files are written and builds pass, but compose was not executed
  this session (validated against local Postgres).

---

## 3. Tech stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | React 18 + TS + Vite + Tailwind v3, React Query, React Router |
| Backend   | Node + TS via **tsx** (no compile step), Fastify, Zod |
| DB        | PostgreSQL + **Prisma** (migrations + typed client) |
| Worker    | Persistent Node process (DB-backed scheduling + WhatsApp) |
| Realtime  | Server-Sent Events (`/api/events`), couple-scoped |
| Movies    | **TMDB API** — instant (typeahead) search, browse/discover, posters, ratings, IMDb ids (**key set**) |
| Places    | **OpenStreetMap** — Nominatim geocode + Overpass POI search for date discovery (**free, keyless**) |
| Emoji     | Auto-pick for date ideas via Claude (optional key; keyword fallback) |
| WhatsApp  | `whatsapp-web.js` (unofficial, free) — **optional**, currently fixture |
| Calendar  | `.ics` invites emailed via **Resend** — **optional**, dormant until keyed |
| Tests     | Vitest (unit/integration, real DB) |
| Delivery  | Docker Compose: db + migrate + server + worker + web(nginx) |

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
        whatsapp/                 # adapter / realAdapter / manager / commands (★ + 👍) / outbox / format
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
docs/visual-qa/ · Dockerfile.* · docker-compose.yml · .env.example · README.md · PLAN.md
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
**before** the client animates; uniform `crypto.randomInt`; `spin` fast-paths to a
reveal and converges on the same result under a `unique(periodId)` conflict; `reroll`
uses optimistic concurrency on `currentRevisionNumber`; `markCompleted` sets
`completedAt` **and** flips the entry to `completed` (excluded from future draws).
Selected/completed entries are excluded from draws.

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

**Pool management** (`PoolPage` + `ProgressRow` + entries service): each partner's count shows
how many are **currently in the pool** (available only — selected/completed/watched are excluded,
so the number matches the visible cards). Deletion is **one-tap, no confirm**, and **either
partner may remove any** movie/idea (e.g. "we watched it") — soft-delete backs an **Undo** toast
(`POST /api/entries/:id/restore`). Editing stays owner-only. Each **movie is unique** in a collection (dedup by `tmdbId` on add + bulk import; adding a dupe returns the existing entry). Marking a movie **completed retires every copy** of it (same `tmdbId`) from the pool, so a watched movie can't linger or be picked again.

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
"userbot" via whatsapp-web.js). Shared selection logic drives web + WhatsApp. Inbound
🔄/✅ reactions and REROLL/DONE replies are deduped, authorised, and guarded against
superseded results. Outbox reconciles uncertain sends. **Currently the fixture
adapter is active** (`WHATSAPP_ENABLED=false`) — messages are recorded, not delivered.
Recipient numbers require a country code (E.164); Settings has a country-prefix picker.

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
pnpm --filter @our52/server test          # 64 tests (needs our52_test DB, migrated)
pnpm --filter @our52/server exec tsc --noEmit -p tsconfig.json   # server typecheck
pnpm --filter @our52/web build            # tsc + vite build
```
Coverage: selection (spin/reveal/reroll/exclusion/uniformity/concurrency, completion),
auth & couple isolation, invitation two-person cap, DST scheduling, worker restart
idempotency + **result message contains the exact picked title (revision-tagged)**,
WhatsApp event dedup, **auto-emoji fallback**, **calendar .ics build + prompt enqueue**.

If tests fail on missing columns, migrate the test DB:
`cd apps/server && DATABASE_URL=postgresql://<you>@localhost:5432/our52_test pnpm exec prisma migrate deploy`

---

## 8. Environment variables (see `.env.example`)

Core: `DATABASE_URL, PORT, APP_BASE_URL, SESSION_SECRET, CORS_ORIGINS, DEMO_MODE,
NODE_ENV, DEFAULT_TIMEZONE/WEEKDAY/TIME, WORKER_TICK_SECONDS, VITE_API_BASE`.

Integrations (all optional; features degrade gracefully):
- `TMDB_API_KEY` — **SET** (v4 read-access token). Movie search/discover/posters/IMDb live.
- `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, default Haiku 4.5) — **SET** → smart Excel movie matching + nicer auto-emojis. Unset → keyword-emoji + string-match fallback.
- `RESEND_API_KEY` + `CALENDAR_FROM_EMAIL` — *not set* → calendar invites dormant.
- `WHATSAPP_ENABLED` — **false** → fixture adapter (no real delivery). `WHATSAPP_SESSION_DIR`, `WHATSAPP_CHROME_PATH`.

In production set `DEMO_MODE=false` and a real `SESSION_SECRET`.

---

## 9. Known gaps / what's NOT verified

- **WhatsApp live delivery & reactions are UNVERIFIED** — no phone paired; the adapter
  is fixture. To go live: `WHATSAPP_ENABLED=true`, restart, Settings → Connect → scan QR,
  then Send test. It's an unofficial client (can disconnect; needs an always-on host).
- **SMS is not implemented** (WhatsApp-only, by choice).
- **Calendar delivery unverified** — needs `RESEND_API_KEY` + both emails in Settings.
  The `.ics` build + 👍/button trigger + idempotency are coded and tested.
- **Smart emoji unverified live** — needs `ANTHROPIC_API_KEY`; keyword fallback works now.
- **Docker compose not executed** this session (built + typechecked only).

---

## 10. Suggested next steps

1. Pair a real WhatsApp phone and verify live send + 🔄/✅/👍 round-trip (incl. calendar).
2. Add `RESEND_API_KEY` + both email addresses → verify a real calendar invite lands.
3. Add `ANTHROPIC_API_KEY` → confirm nicer auto-emojis on date ideas.
4. `docker compose up --build` smoke test end-to-end.
5. Custom collections UI (backend supports them; add a "＋ New collection" tab entry).
6. Optional: import personal IMDb ratings via CSV export; multi-instance realtime
   (swap the in-process bus for Postgres LISTEN/NOTIFY or Redis) if scaling past one process.
```
