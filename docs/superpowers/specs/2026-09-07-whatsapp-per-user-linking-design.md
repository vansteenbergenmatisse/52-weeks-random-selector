# Per-user WhatsApp linking + mutual reminders — design

> Date: 2026-09-07 · Status: approved, ready for implementation

## Problem

Today WhatsApp is a single **couple-level** connection (`WhatsAppSession @unique(coupleId)`),
one shared QR, and reminders are delivered to manually-typed **recipient numbers**
(`WhatsAppConfig.recipients`). The couple wants:

1. **Per-person linking.** Matisse and Teresa each link their **own** WhatsApp separately — two
   independent sessions, two independent QRs.
2. **No recipient number field.** Each person's number comes from *their own* linked WhatsApp
   (the paired device's own number). You re-link to change it; you never type a number.
3. **Mutual reminders.** When both are connected, the weekly reminder Teresa receives is sent
   **from Matisse's WhatsApp** (looks like Matisse texted her), and Matisse's is sent from
   Teresa's. Sending requires both linked (sender sends, recipient's number comes from their link).
4. **Global vs personal split.** Collection settings (schedule, name, contribution target,
   auto-select, "send reminders on WhatsApp" toggle) and calendar invites stay **couple-shared**.
   Only the **WhatsApp connection** is per-person.

## Non-goals

- No change to the keyless calendar feature, collection settings, selection, or theme.
- No group-chat delivery. `WhatsAppConfig` (recipients/group/deliveryMode) is retired from use.
- Not removing the `WhatsAppConfig` table (left dormant to avoid a destructive migration).

## Data model changes

### `WhatsAppSession` — re-key per user
```prisma
model WhatsAppSession {
  id        String   @id @default(cuid())
  coupleId  String                      // kept for scoping/queries
  userId    String   @unique            // NEW — one linked WhatsApp per person
  status    String   @default("disconnected")
  phone     String?
  lastQr    String?
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())

  couple Couple @relation(fields: [coupleId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([coupleId])
}
```
- `@unique` moves from `coupleId` to `userId`.
- `User` gains a `whatsappSession WhatsAppSession?` back-relation.
- **Migration:** the old table is keyed by `coupleId` with no `userId`; existing rows are
  disposable (prod ran the fixture adapter — nothing was really paired). The migration drops
  old `WhatsAppSession` rows and rebuilds the table with the `userId` unique key. Re-linking is
  expected and required.

### `OutboundMessage` — record the sender
```prisma
senderUserId String?   // NEW — whose WhatsApp this row goes out from (null for legacy/calendar rows)
```
Lets the outbox flush each row on the correct per-user adapter. Nullable so calendar prompts /
any non-reminder rows and old rows still work.

### `WhatsAppConfig` — dormant
No schema change; the code stops reading/writing `recipients`, `groupId`, `deliveryMode`. The
recipient UI is removed.

## Server design

### Members helper
`coupleMembers(coupleId) → { self, partner }` given a userId, or `[userA, userB]` — read the two
`Membership` rows. Used to resolve cross-send sender/recipient pairs.

### Manager (`features/whatsapp/manager.ts`) — per user
- `adapters: Map<userId, WhatsAppAdapter>` (was keyed by coupleId).
- Baileys auth dir: `join(WHATSAPP_SESSION_DIR, "user-" + userId)` (was `couple-<id>`).
- `getAdapter(userId, coupleId)`, `connect(userId, coupleId)`, `disconnect(userId)`,
  `getStatusForUser(userId)`.
- `syncStatus(userId, coupleId, status, phone, qr)` upserts `WhatsAppSession` by `userId`.
- `wire(adapter, coupleId)` — inbound events still dispatch `handleInbound(coupleId, event)`
  (dedup by `eventKey` unchanged); outbox flush becomes per-user (below).
- `healConnections()` iterates connected **user** sessions.

### Activation (`getActivation(coupleId)`)
```
members     = coupleMembers(coupleId)          // up to 2
linkedById  = which members have status==="connected"
bothLinked  = members.length === 2 && all linked
activated   = bothLinked
```
Returns per-member link status (for the UI) plus `activated`. `isActivated(coupleId)` =
`getActivation().activated`. Used by the worker + `updateCollection` reminder-toggle gate.

### Sending — cross-send + per-user outbox
- **Enqueue reminder** (`enqueueReminder(coupleId, {body builder})`): for each member `R`, the
  sender is the **other** member `P`. Create an `OutboundMessage` with `senderUserId = P.id` and
  `chatId = <R's session.phone>@c.us`. Skip a direction if `R` has no linked number yet.
- **Flush per user**: `flushOutboxForUser(userId, adapter)` sends pending rows where
  `senderUserId === userId` (rows with null sender still flush on any connected member's adapter,
  preserving calendar-prompt behavior). Reconcile logic unchanged, scoped by sender.
- `flush(coupleId)` / `healConnections` iterate each connected member and drain their rows.
- The old `resolveTargets(coupleId)` (recipients/self-number) is **removed**; targets are now the
  partner's number from their session.

### Test message
`POST /api/whatsapp/test` (logged-in user `U`):
- recipient = partner if partner linked, else `U` (self-fallback), noted in the response.
- sender adapter = `U`'s session. Enqueue with `senderUserId = U.id`, then flush `U`.

### Routes (`app/routes/whatsapp.routes.ts`)
- `GET /api/whatsapp/status` → `{ enabled, you: {status, phone, qr, linked}, partner: {linked, name}, activated, note }` for the logged-in user.
- `POST /api/whatsapp/connect` → connect **your** session (`requireCouple` gives `user.id` + `coupleId`).
- `POST /api/whatsapp/disconnect` → disconnect **your** session.
- `POST /api/whatsapp/test` → per above.
- **Removed:** `PATCH /api/whatsapp/config`.

### Worker
`tick()` notify path calls `enqueueReminder` + per-user flush, gated on `isActivated` (both linked).

## Web design (`features/settings/SettingsDialog.tsx` + `roulette/hooks.ts`)
- WhatsApp section relabeled **"Your WhatsApp (just you)"**.
  - Your live banner + QR + **"Link my WhatsApp"** (calls `/connect`) + Connect/Disconnect.
  - Read-only **partner status line**: "Teresa's WhatsApp: ✅ linked / ⬜ not linked yet →
    reminders start when both are linked."
  - **Delete** recipient-number inputs, country picker, and `saveAndLink`'s number handling.
    "Link my WhatsApp" just connects the current user's session.
  - "Send test message" unchanged in placement; hits the new per-user test route.
- Status shape in `hooks.ts` updated: `{ enabled, you:{status,phone,qr,linked}, partner:{linked,name}, activated }`.
- Reminder toggle still gated on `activated` (both linked); help text: "Link both WhatsApps to turn reminders on."
- Calendar section unchanged (global, keyless button already shipped).

## Testing
- `WhatsAppSession` keyed per user: two members link independently; statuses independent.
- `getActivation`: not activated with one linked; activated only when both linked.
- Cross-send mapping: reminder rows are (senderUserId=A, chatId=B.phone) and (senderUserId=B, chatId=A.phone).
- `flushOutboxForUser` sends only that user's rows.
- Test message targets partner when linked, else self.
- Reminder gate: worker enqueues nothing unless both linked.

## Migration & rollout
- One Prisma migration: rebuild `WhatsAppSession` (userId unique) + add `OutboundMessage.senderUserId`.
- Deploy via `railway up` (GitHub auto-deploy is not firing). `start:prod` runs `migrate deploy`.
- `WHATSAPP_ENABLED=true` still required on the server for real pairing (unchanged, user action).

## Risks
- Unofficial Baileys client can drop; per-user doubles the sessions to keep healthy (existing
  backoff + heal apply per user).
- Both-linked requirement means reminders are silent until both pair — surfaced in the UI banner.
