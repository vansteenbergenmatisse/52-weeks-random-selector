import { prisma } from "../../platform/db/prisma.js";
import { logger } from "../../platform/logger/logger.js";
import type { WhatsAppAdapter } from "./adapter.js";

export type MessageKind = "result" | "reminder" | "reroll" | "test" | "calendar_prompt";

export interface Member {
  userId: string;
  displayName: string;
  phone: string | null; // the member's own linked WhatsApp number
  connected: boolean; // their session is live right now
}

/** The couple's members with their linked-WhatsApp number + live connection state. */
export async function coupleMembers(coupleId: string): Promise<Member[]> {
  const memberships = await prisma.membership.findMany({
    where: { coupleId },
    include: { user: { include: { whatsappSession: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    userId: m.userId,
    displayName: m.user.displayName,
    phone: m.user.whatsappSession?.phone ?? null,
    connected: m.user.whatsappSession?.status === "connected",
  }));
}

function toChatId(phone: string): string {
  return phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@c.us`;
}

export interface BroadcastInput {
  coupleId: string;
  kind: MessageKind;
  body: string;
  collectionId?: string | null;
  weeklyResultId?: string | null;
  revisionNumber?: number | null;
}

/**
 * Broadcast a couple message to BOTH partners, cross-sent: each partner receives
 * it FROM the other's linked WhatsApp (so Teresa's pick looks like Matisse texted
 * her, and vice-versa). A direction is created only when the recipient has a
 * linked number AND the sender (the other partner) is currently connected — i.e.
 * both must be linked for anything to go out. Returns the created row ids.
 */
export async function enqueueBroadcast(input: BroadcastInput): Promise<string[]> {
  const members = await coupleMembers(input.coupleId);
  if (members.length !== 2) return [];
  const ids: string[] = [];
  for (const recipient of members) {
    const sender = members.find((m) => m.userId !== recipient.userId)!;
    if (!recipient.phone || !sender.connected) continue;
    const row = await prisma.outboundMessage.create({
      data: {
        coupleId: input.coupleId,
        collectionId: input.collectionId ?? null,
        weeklyResultId: input.weeklyResultId ?? null,
        revisionNumber: input.revisionNumber ?? null,
        kind: input.kind,
        body: input.body,
        chatId: toChatId(recipient.phone),
        senderUserId: sender.userId,
        status: "pending",
      },
    });
    ids.push(row.id);
  }
  if (ids.length === 0) {
    logger.info(
      { coupleId: input.coupleId, kind: input.kind },
      "No linked WhatsApp pair (both partners must be connected); skipping broadcast",
    );
  }
  return ids;
}

export interface DirectInput {
  coupleId: string;
  senderUserId: string;
  chatId: string;
  kind: MessageKind;
  body: string;
}

/** Enqueue a single message that must go out FROM a specific user's session. */
export async function enqueueDirect(input: DirectInput): Promise<string> {
  const row = await prisma.outboundMessage.create({
    data: {
      coupleId: input.coupleId,
      kind: input.kind,
      body: input.body,
      chatId: toChatId(input.chatId),
      senderUserId: input.senderUserId,
      status: "pending",
    },
  });
  return row.id;
}

const MAX_ATTEMPTS = 5;
const RETRY_GRACE_MS = 2 * 60_000;

/**
 * Send all pending rows that must go out on THIS user's session. Rows stamped
 * with a null senderUserId (nothing pinned them to a sender) also flush here so
 * they aren't stranded. Uncertain sends are marked for later reconciliation
 * rather than blindly retried, so a partner never gets the same message twice.
 */
export async function flushOutboxForUser(userId: string, adapter: WhatsAppAdapter): Promise<void> {
  const pending = await prisma.outboundMessage.findMany({
    where: {
      coupleId: adapter.coupleId,
      status: "pending",
      chatId: { not: null },
      OR: [{ senderUserId: userId }, { senderUserId: null }],
    },
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
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: "uncertain", lastError: String(err) },
      });
      logger.warn({ err: String(err), msgId: msg.id }, "WhatsApp send errored (marked uncertain)");
    }
  }
}

/**
 * Reconcile stranded rows for this sender (failed/uncertain), then flush.
 * - "failed" definitely didn't go out, so it's safe to resend.
 * - "uncertain" MIGHT have gone out; retried after a grace period under a low
 *   attempt cap — a rare duplicate beats silently dropping the week's pick.
 */
export async function reconcileOutboxForUser(userId: string, adapter: WhatsAppAdapter): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_GRACE_MS);
  await prisma.outboundMessage.updateMany({
    where: {
      coupleId: adapter.coupleId,
      status: { in: ["failed", "uncertain"] },
      attempts: { lt: MAX_ATTEMPTS },
      chatId: { not: null },
      OR: [{ senderUserId: userId }, { senderUserId: null }],
      AND: [{ OR: [{ sentAt: null }, { sentAt: { lt: cutoff } }] }],
    },
    data: { status: "pending" },
  });
  await flushOutboxForUser(userId, adapter);
}
