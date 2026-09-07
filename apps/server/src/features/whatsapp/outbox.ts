import { prisma } from "../../platform/db/prisma.js";
import { logger } from "../../platform/logger/logger.js";
import type { WhatsAppAdapter } from "./adapter.js";

export interface EnqueueInput {
  coupleId: string;
  kind: "result" | "reminder" | "reroll" | "test" | "calendar_prompt";
  body: string;
  collectionId?: string | null;
  weeklyResultId?: string | null;
  revisionNumber?: number | null;
}

/** Resolve the target chat ids from a couple's WhatsApp config. */
export async function resolveTargets(coupleId: string): Promise<string[]> {
  const cfg = await prisma.whatsAppConfig.findUnique({ where: { coupleId } });
  if (cfg?.deliveryMode === "group") return cfg.groupId ? [cfg.groupId] : [];
  let recipients = cfg ? safeJsonArray(cfg.recipients) : [];
  if (recipients.length === 0) {
    // No recipient was typed in — default to the linked phone's OWN number, which
    // Baileys captures on connect (session.phone). This lets a couple link their
    // phone and immediately get reminders on that device without ever entering a
    // number. An explicit recipient (or group) always takes precedence when set.
    const session = await prisma.whatsAppSession.findUnique({ where: { coupleId } });
    if (session?.phone) recipients = [session.phone];
  }
  // Normalise bare phone numbers to WhatsApp chat ids.
  return recipients.map((r) => (r.includes("@") ? r : `${r.replace(/\D/g, "")}@c.us`));
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Create one pending outbox row per resolved target chat. */
export async function enqueue(input: EnqueueInput): Promise<string[]> {
  const targets = await resolveTargets(input.coupleId);
  if (targets.length === 0) {
    logger.info({ coupleId: input.coupleId, kind: input.kind }, "No WhatsApp targets configured; skipping enqueue");
    return [];
  }
  const ids: string[] = [];
  for (const chatId of targets) {
    const row = await prisma.outboundMessage.create({
      data: {
        coupleId: input.coupleId,
        collectionId: input.collectionId ?? null,
        weeklyResultId: input.weeklyResultId ?? null,
        revisionNumber: input.revisionNumber ?? null,
        kind: input.kind,
        body: input.body,
        chatId,
        status: "pending",
      },
    });
    ids.push(row.id);
  }
  return ids;
}

const MAX_ATTEMPTS = 5;
const RETRY_GRACE_MS = 2 * 60_000;

/**
 * Reconcile rows that flushOutbox left in a non-terminal state, then flush.
 * Without this, a row that goes "failed" (adapter returned ok:false — never
 * sent) or "uncertain" (send threw / process crashed mid-send) is a permanent
 * dead end and the message is silently lost.
 *
 * - "failed" definitely didn't go out, so it's safe to resend.
 * - "uncertain" MIGHT have gone out; Baileys can't cheaply confirm delivery, so
 *   we retry it too but only after a grace period and under a low attempt cap —
 *   a rare duplicate reminder is far better than silently dropping the week's
 *   pick. Attempts are bounded so a permanently-bad row eventually gives up.
 */
export async function reconcileOutbox(adapter: WhatsAppAdapter): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_GRACE_MS);
  await prisma.outboundMessage.updateMany({
    where: {
      coupleId: adapter.coupleId,
      status: { in: ["failed", "uncertain"] },
      attempts: { lt: MAX_ATTEMPTS },
      chatId: { not: null },
      OR: [{ sentAt: null }, { sentAt: { lt: cutoff } }],
    },
    data: { status: "pending" },
  });
  await flushOutbox(adapter);
}

/**
 * Send all pending outbox rows for a couple via its adapter. Uncertain sends
 * are marked "uncertain" for later reconciliation (see reconcileOutbox) rather
 * than blindly retried inline, so a partner never gets the same message twice.
 */
export async function flushOutbox(adapter: WhatsAppAdapter): Promise<void> {
  const pending = await prisma.outboundMessage.findMany({
    where: { coupleId: adapter.coupleId, status: "pending", chatId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const msg of pending) {
    // Claim the row so a concurrent flush can't double-send.
    const claimed = await prisma.outboundMessage.updateMany({
      where: { id: msg.id, status: "pending" },
      data: { status: "uncertain", attempts: { increment: 1 }, sentAt: new Date() },
    });
    if (claimed.count !== 1) continue;

    try {
      const res = await adapter.sendMessage({ chatId: msg.chatId! }, msg.body);
      if (res.ok) {
        await prisma.outboundMessage.update({
          where: { id: msg.id },
          data: { status: "sent", waMessageId: res.id, lastError: null },
        });
      } else if (res.uncertain) {
        await prisma.outboundMessage.update({
          where: { id: msg.id },
          data: { status: "uncertain", lastError: res.error ?? "uncertain outcome" },
        });
      } else {
        await prisma.outboundMessage.update({
          where: { id: msg.id },
          data: { status: "failed", lastError: res.error ?? "send failed" },
        });
      }
    } catch (err) {
      // Left as "uncertain": the message may or may not have gone out.
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: "uncertain", lastError: String(err) },
      });
      logger.warn({ err: String(err), msgId: msg.id }, "WhatsApp send errored (marked uncertain)");
    }
  }
}
