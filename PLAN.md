# Our 52 — Project Context & Handoff (PLAN.md)

> Single-file context so you can clear memory and pick this up cold.
> Last updated: 2026-09-07.

---

## 0. ACTIVE TODO (2026-09-07) — honest status

### This session's changes (2026-09-07, latest+1) — pool reset, no example seeds

Bug reports + a testing request. Root causes found (see `selection/service.ts`, `entries/service.ts`):
per-person counts count `status:"available"` only, while the grid also shows **completed "✓ Watched"
cards** and a spun pick becomes `selected` (shown on the roulette page) — so visible items exceed the
count. Spin already refuses an empty pool (no ghost). The "random ideas" were the **example seed**.

1. ✅ **[Reset] Per-collection "Reset to zero" (testing).** `resetToZero(coupleId, collectionId)` +
   `POST /api/collections/:id/reset` + a 🧨 button in that collection's Settings. Wipes ALL ideas
   (incl. the current pick, completed, and soft-deleted), every weekly result, and history, then
   restarts the cycle from a fresh slot. Pool → truly 0, no pick shows.
2. ✅ **[Seed] No example ideas by default.** The 12 demo dates / 12 demo movies now only seed when
   `SEED_EXAMPLES=true`; a fresh space starts **empty** (no "random shit added").
3. ✅ **[Skip] Confirmed correct** — `skip()` returns the skipped idea to the pool (`available`) and
   draws a different one; locked in with a regression test. No fix needed.

### This session's changes (2026-09-07, latest) — WhatsApp per-user linking + mutual reminders

Reworked WhatsApp from ONE shared couple connection to **per-person linking**. Matisse and Teresa
each link their own phone (separate `WhatsAppSession` keyed by `userId`, separate QR). **No
recipient number field** — the number comes from each person's link. **Reminders are mutual and
cross-sent**: Teresa's weekly pick is sent FROM Matisse's WhatsApp and vice-versa, so both must be
linked. Settings shows "Your WhatsApp (just you)" + the partner's link status. Collection settings
and calendar stay global/shared. Spec: `docs/superpowers/specs/2026-09-07-whatsapp-per-user-linking-design.md`.
All ✅ in code; still needs `WHATSAPP_ENABLED=true` + each partner scanning their QR.

### Earlier this session (2026-09-07, later) — WhatsApp self-config + keyless calendar

Reduce the manual setup so the couple can just link a phone and test. **All ✅ done in code
(80 tests pass); WhatsApp still needs the `WHATSAPP_ENABLED=true` flag + one live scan.**

1. ✅ **[WhatsApp] No recipient number to type.** Linking captures the paired device's OWN
   number (`session.phone`, from Baileys `sock.user.id`). `resolveTargets` now defaults to that
   number when no recipient is configured, so reminders + the Test button send to the linked
   phone with zero typing. Explicit numbers (in Settings) still override / add extra recipients.
2. ✅ **[WhatsApp] Activation = link only.** `getActivation` now activates on a linked phone
   alone; the calendar-email requirement is **decoupled** from reminders (it never belonged
   there). Settings checklist is now one step ("Link WhatsApp"), banners/help updated.
3. ✅ **[Calendar] Keyless "Add to calendar".** New `GET /api/collections/:id/calendar/current`
   returns the pick's `.ics` text + an "Add to Google Calendar" link. The web button now
   downloads the `.ics` and shows a Google link — **no Resend key, no configured emails**. The
   old email-via-Resend path stays as an optional extra.

### Prior sub-session (2026-09-07, earlier)

Corrections after the last session over-claimed. **WhatsApp was NOT actually working** — the
code was hardened but prod ran the *fixture* adapter (`WHATSAPP_ENABLED` unset → false), so
"Connect" faked a link and no QR ever appeared. Verified locally that the Baileys QR path DOES
produce a real scannable QR (7KB PNG data URL), so the blocker is purely the flag + a live scan.

Work in that sub-session (all ✅ done in code; WhatsApp needs the flag flipped + a live scan):

1. ✅ **[WhatsApp] Make it actually link.** Library stays **Baileys** (`baileys@7.0.0-rc14`, free,
   no Chromium — confirmed emits a real QR). Set `WHATSAPP_ENABLED=true` +
   `WHATSAPP_SESSION_DIR=/data/whatsapp` on Railway so the real adapter runs. Then Settings →
   "Save & link WhatsApp" shows a **real QR** to scan (WhatsApp → Linked devices → Link a device).
   Stop the UI/banner from ever implying "connected" when it isn't. Still can't fully verify the
   scan+pair without the phone, but the QR now appears.
2. ✅ **[Login] Show-password toggle** on the login page (space passcode + password fields).
3. ✅ **[Selection] Skip button on every pick (dates & movies).** `selection.skip()` returns the
   skipped idea/movie to the pool (status → available, reusable in future weeks) and draws a new
   pick excluding it; new `ResultRevision` (reason `skip`). `POST /skip` route + `useSkip` +
   ⏭️ Skip button in ResultPanel (animates the reel to the new pick). Replaces the old
   "pick is LOCKED / reroll disabled" rule.
4. ✅ **[Selection] Spin reliability.** Carousel now starts the animation the moment the winner is
   known (keyed on `winner?.id` with a `lastSpunToken` guard) so a lagging winner can't leave the
   reel frozen; always settles.

---

---

## 1. What this is

**Our 52** is a private **couples activity roulette**. Each couple has a shared,
isolated space with two collections by default — **Dates** and **Movies** — fills
them with ideas, and every week spins a **CS:GO-style "case opening" carousel** to
pick one activity. You can reroll, mark it done, browse history, add a pick to your
calendars, and (optionally) drive it all from WhatsApp with 🔄 / ✅ / 👍 reactions.

The couple is **Teresa & Matisse**. The look is a warm, romantic **"fun love"**
theme (sunset/berry tones, no blue) with a per-person accent colour.

**Status: LIVE on Railway, running, tested.** 85 server tests pass; web build + server
typecheck are green. **Live URL → https://52-weeks-random-selector-production.up.railway.app**

**Earlier 2026-09-07 session (bug-hunt gate + passcode login + WhatsApp hardening; now on `main`):**
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
- **WhatsApp connection code hardened (§10 items 2–4)** — reconnect backoff, outbox
  reconciliation, self-heal, group activation, live banner, "Save & link" flow. **BUT it was
  still running the fixture adapter in prod (`WHATSAPP_ENABLED` unset), so it never actually
  linked.** See §0 — enabling the flag + real QR is this session's fix.

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
| WhatsApp  | **Baileys** (unofficial, free, no browser) — **optional**, **per-user linking** (each partner links their own phone) + **mutual cross-sent reminders**; currently fixture until `WHATSAPP_ENABLED=true` |
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
- `WhatsAppSession @unique(userId)` — **per-user** link (each partner's own phone); keeps
  `coupleId` (indexed) for scoping, `phone` = the paired device's own number, `status`, `lastQr`.
- `WhatsAppConfig` — **dormant** (old delivery mode + recipient numbers); no longer read/written.
- `CalendarConfig` — per couple: `enabled`, `emails` (JSON), `durationMins`.
- `OutboundMessage` — WhatsApp outbox (kinds: result/reminder/reroll/test/**calendar_prompt**),
  tracks `waMessageId` + status for reconciliation, plus **`senderUserId`** = whose linked
  WhatsApp the row goes out FROM (cross-send).
- `ProcessedInboundEvent @unique(eventKey)` — inbound dedup ledger.
- `JobRun @unique(jobKey)` — worker idempotency (`select:<periodId>`, `notify:<periodId>`).

---

## 6. Core behaviours (the subtle parts)

**Selection** (`features/selection/service.ts`): server picks + persists the winner
**before** the client animates; uniform `crypto.randomInt`. Whoever spins first (or the Sunday
auto-spin) decides the week; concurrent spins converge on ONE result via `unique(periodId)`.
**A pick can be SKIPPED** (`selection.skip()`, `POST /skip`, ⏭️ button): the skipped entry goes
back to the pool (status → available) and a new winner is drawn excluding it, recorded as a new
`ResultRevision` (reason `skip`). `reroll()` remains a legacy no-op (`reason:"locked"`); skip is
the supported path. `markCompleted` sets `completedAt` **and**
flips the picked entry to `completed` (**only that copy** — other copies of the same
movie stay for a re-watch). Selected/completed entries are excluded from draws.
**Pool is the source of truth:** a weekly result only shows if its pick is still a
live pool entry — if the pick was removed, `getCurrentState`/`spin` treat the week as
re-spinnable (spin discards the stale result and draws fresh), so an emptied pool never
replays a "ghost" pick. `spin` refuses an empty available pool (`eligibleEntryIds` is
`status:"available"` only → throws, no ghost). History reads immutable snapshots, untouched.
**Counts = available only:** `getProgress`/`availableCount` count `status:"available"`; the grid
also shows `completed` "✓ Watched" cards and a `selected` pick shows on the roulette page, so
visible items can exceed the count (by design, not a bug).
**Reset to zero** (`selection.resetToZero`, `POST /api/collections/:id/reset`, 🧨 button in a
collection's Settings): testing wipe of ONE collection — hard-deletes every entry (incl. current
pick, completed, soft-deleted), deletes all `weeklyPeriod` (cascades results+revisions → clears
history) and the collection's outbound rows, then restarts the cycle (`cycleIndex 0`, fresh
`cycleStartDate`). Pool → truly 0, no pick shows. FK-safe (`ResultRevision.entryId` is SetNull).

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

**WhatsApp** (`features/whatsapp/*`): **per-user linking + mutual reminders** (design:
`docs/superpowers/specs/2026-09-07-whatsapp-per-user-linking-design.md`). Each partner links their
OWN phone — `WhatsAppSession` is keyed by `userId` (unique), Baileys auth lives under
`WHATSAPP_SESSION_DIR/user-<userId>`, adapters are keyed by userId, and on connect Baileys reports
that device's own number (`sock.user.id` → `session.phone`). **There is no recipient field.**
**Reminders are cross-sent** (`enqueueBroadcast`): the weekly pick Teresa receives is sent FROM
Matisse's linked WhatsApp and vice-versa — one `OutboundMessage` per recipient stamped with
`senderUserId`, drained on that sender's session (`flushOutboxForUser`). A direction is created
only when the recipient has a linked number and the sender is connected, so **both must be linked**.
The **Test** button (`sendTest`) sends from your session to your partner (self-fallback if they're
not linked). Inbound 🔄/✅/👍/REROLL/DONE are deduped, authorised **against the couple's own linked
numbers**, and guarded against superseded results. Outbox reconciles uncertain sends per user.
**Activation** = `getActivation.activated` is true only when **both partners are linked**; the
per-collection reminder toggle stays global/shared but is gated on it (worker + `updateCollection`
enforce `isActivated`). `WhatsAppConfig` (old recipients/group) is **dormant** — no longer used.
**Currently the fixture adapter is active** (`WHATSAPP_ENABLED=false`) — messages are recorded,
not delivered; set the flag on the server for real pairing.

**Calendar** (`features/calendar/*`): the app's **"Add to calendar" button is keyless** —
`GET /api/collections/:id/calendar/current` (`getCurrentInvite`) returns the pick's `.ics` text
plus an "Add to Google Calendar" template link; the web downloads the `.ics` and surfaces the
Google link, so either partner adds it to their own calendar with **no Resend key and no
configured emails**. Event time = the collection's scheduled slot; location included.
**Optional email path (needs Resend):** after a weekly pick, a "📅 add to calendar?" WhatsApp
message is enqueued *when calendar emails are configured*; a **👍** on it — or `addResultToCalendar`
— emails the `.ics` to both partners via Resend, idempotent per pick (`calendarInvitedAt`).

**Theme**: warm "fun love" palette (no blue) in `tailwind.config.js` + `styles/index.css`;
`--accent` is a CSS variable overridden per logged-in user (Teresa → rose, Matisse →
coral) via `data-user` on `<html>` (set in `App.tsx`).

**Live sync**: mutations `publish()` to an in-process bus → `/api/events` SSE → web
invalidates React Query. Fallback: refetch on window focus.

---

## 7. Tests & verification

```bash
pnpm --filter @our52/server test          # 85 tests (SQLite; schema auto-created by globalSetup)
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
inline worker), `VITE_API_BASE`. `SEED_EXAMPLES` (default **false**) — set `true` to seed the
12 demo dates / 12 demo movies; otherwise a fresh space starts **empty**.

Integrations (all optional; features degrade gracefully):
- `TMDB_API_KEY` — **SET** (v4 read-access token). Movie search/discover/posters/IMDb live.
- `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, default Haiku 4.5) — **SET** → smart Excel movie matching + nicer auto-emojis. Unset → keyword-emoji + string-match fallback.
- `RESEND_API_KEY` + `CALENDAR_FROM_EMAIL` — *not set* → calendar invites dormant.
- `WHATSAPP_ENABLED` — **false** → fixture adapter (no real delivery); set `true` for real per-user pairing. `WHATSAPP_SESSION_DIR` (Baileys multi-file auth, now **per-user** dirs `user-<userId>`; container default `/data/whatsapp`). *(No Chrome path — Baileys needs no browser.)*

In production set a real `SESSION_SECRET`. **`DEMO_MODE=true` is intentionally ON in prod**
(private shared space) so the one-tap Teresa/Matisse picker works; the demo gate is decoupled
from `NODE_ENV` (`demoEnabled = env.DEMO_MODE`). **Set `SPACE_PASSCODE`** in prod so the picker
requires a shared secret (a stranger with the URL can't tap straight in); the seeded accounts have
no client-usable password and sign in only via `POST /api/auth/space-login`. `DEMO_PASSWORD` is
optional (a strong random one is generated on first seed otherwise, never logged).

---

## 9. Known gaps / what's NOT verified

- **WhatsApp live pairing is the ONE unverified path** — now **per-user**. Each partner links
  their own phone (separate `WhatsAppSession`/QR/Baileys auth dir); reminders are **mutual and
  cross-sent** and need BOTH linked. The adapter has capped backoff+jitter reconnect, outbox
  reconciliation, and per-tick `healConnections()`; creds persist under `WHATSAPP_SESSION_DIR`
  (`user-<id>`, container default `/data/whatsapp`). Settings shows "Your WhatsApp (just you)" +
  partner status. **Still unverified:** actual QR pairing/send with real phones (needs
  `WHATSAPP_ENABLED=true` and **each** partner to scan). Unofficial client — reconnect/heal
  logic untested against a live socket.
- **SMS is not implemented** (WhatsApp-only, by choice).
- **Calendar (keyless) works with no keys** — the "Add to calendar" button downloads the `.ics`
  and offers a Google Calendar link (`getCurrentInvite`, tested). Only the **optional** email
  path (auto-emailing the invite to both partners) is unverified — that one needs
  `RESEND_API_KEY` + both emails in Settings.
- **Railway deploy DONE** ✅ — live at the URL in §1 as **one service** (API serves the web
  app) built from the root `Dockerfile`, with a Volume at `/data`,
  `DATABASE_URL=file:/data/our52.db`, and `SESSION_SECRET`/`APP_BASE_URL`/`CORS_ORIGINS`/keys
  set. Kept at **one replica** (SQLite + in-process live-sync). `start:prod` migrates + seeds
  on boot; verified live (`/api/health` 200, login + locked pick + shared space all work).
  **⚠️ GitHub auto-deploy is NOT firing** — a `git push` alone does not redeploy. Deploy with
  `railway up --detach --service 52-weeks-random-selector --environment production` (project
  `extraordinary-strength`). To restore auto-deploy: reconnect the GitHub source in the Railway
  service settings (dashboard toggle).
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
(6 high / 13 med / 10 low), all fixed** with 7 regression tests. See the bug-hunt-gate session
note in §1 for the highlight list.

### WhatsApp connection — code DONE (per-user); real pairing needs phones
1. **Real connection (ONLY remaining step)** — set `WHATSAPP_ENABLED=true` on the server. Then
   **each partner** logs in → Settings → **"Link my WhatsApp"** → scans the QR on their own phone.
   Once BOTH show linked, "Send test message" goes to the partner (mutual reminders unlock). Creds
   persist per user under `WHATSAPP_SESSION_DIR` (`user-<id>`) across redeploys. Can't verify
   without two phones.
2. ✅ **Per-user linking + mutual cross-send** — each partner links their own phone; the weekly
   pick each receives is sent FROM the other's WhatsApp. No recipient field. Both must be linked.
3. ✅ **Automatic disconnects** — capped exponential backoff + jitter reconnect in `baileysAdapter`;
   per-tick `healConnections()` reconnects any drifted user session and drains their outbox.
4. ✅ **Settings UI** — "Your WhatsApp (just you)": Link/Unlink your phone, your QR, a live banner,
   and a read-only partner status line. Reminders gated on both linked.

### Later / optional
5. (Optional) Add `RESEND_API_KEY` + both emails → verify the *emailed* calendar invite lands.
   Not required for calendar: the keyless "Add to calendar" button (download + Google link) works
   with no keys.
6. ✅ `docker compose up --build` smoke test — ran this session; both containers up, API 200,
   web 200, nginx `/api` proxy 200. Validates the local two-service compose path.
7. Custom collections UI (backend supports them; add a "＋ New collection" tab entry).
8. Import personal IMDb ratings via CSV; multi-instance realtime (swap in-process bus for
   Postgres LISTEN/NOTIFY or Redis) only if scaling past one process.
