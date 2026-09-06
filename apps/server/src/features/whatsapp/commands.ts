import { Prisma } from "@prisma/client";
import { prisma } from "../../platform/db/prisma.js";
import { logger } from "../../platform/logger/logger.js";
import { eventKey } from "../../platform/security/crypto.js";
import type { InboundEvent } from "./adapter.js";
import { enqueue } from "./outbox.js";
import * as selection from "../selection/service.js";
import { addResultToCalendar } from "../calendar/service.js";
import { formatReroll, formatReminder, formatNoAlternative, formatAmbiguous, formatCalendarBooked } from "./format.js";

const REROLL_EMOJIS = new Set(["🔄", "🔁", "♻️"]);
const DONE_EMOJIS = new Set(["✅", "☑️", "✔️"]);
const isThumbsUp = (emoji: string) => /\u{1F44D}/u.test(emoji); // 👍 (any skin tone)

function normalizePhone(id: string): string {
  return id.replace(/@.*/, "").replace(/\D/g, "");
}

async function isAuthorizedSender(coupleId: string, senderId: string): Promise<boolean> {
  const cfg = await prisma.whatsAppConfig.findUnique({ where: { coupleId } });
  if (!cfg) return false;
  let recipients: string[] = [];
  try {
    recipients = JSON.parse(cfg.recipients);
  } catch {
    recipients = [];
  }
  const sender = normalizePhone(senderId);
  return recipients.map(normalizePhone).includes(sender);
}

async function alreadyProcessed(coupleId: string, key: string): Promise<boolean> {
  try {
    await prisma.processedInboundEvent.create({ data: { coupleId, eventKey: key } });
    return false;
  } catch (e) {
    // Unique violation => replayed/duplicate event.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return true;
    throw e;
  }
}

async function collectionMeta(collectionId: string) {
  return prisma.collection.findUnique({
    where: { id: collectionId },
    select: { id: true, name: true, kind: true, coupleId: true },
  });
}

/**
 * Central inbound handler for WhatsApp reactions and replies. Ignores removed
 * reactions, bot-authored events, unauthorized senders, replayed events, and
 * commands against superseded results.
 */
export async function handleInbound(coupleId: string, event: InboundEvent): Promise<void> {
  if (event.fromMe) return; // never act on the paired account's own messages
  if (event.kind === "reaction" && event.removed) return; // ignore reaction removals

  if (!(await isAuthorizedSender(coupleId, event.senderId))) {
    logger.info({ coupleId }, "Ignoring WhatsApp event from unauthorized sender");
    return;
  }

  if (event.kind === "reaction") return handleReaction(coupleId, event);
  return handleReply(coupleId, event);
}

async function handleReaction(coupleId: string, event: Extract<InboundEvent, { kind: "reaction" }>) {
  const isReroll = REROLL_EMOJIS.has(event.emoji);
  const isDone = DONE_EMOJIS.has(event.emoji);
  const isThumbs = isThumbsUp(event.emoji);
  if (!isReroll && !isDone && !isThumbs) return;

  const msg = await prisma.outboundMessage.findFirst({
    where: { coupleId, waMessageId: event.messageId },
  });
  if (!msg || !msg.collectionId) return; // not one of our messages

  const key = eventKey([event.messageId, event.emoji, event.senderId, msg.revisionNumber]);
  if (await alreadyProcessed(coupleId, key)) return;

  // 👍 on the "add to calendar?" message books it into both calendars.
  if (isThumbs) {
    if (msg.kind !== "calendar_prompt") return;
    const res = await addResultToCalendar(coupleId, msg.collectionId);
    if (res.ok) {
      const state = await selection.getCurrentState(coupleId, msg.collectionId);
      await enqueue({
        coupleId,
        kind: "result",
        collectionId: msg.collectionId,
        body: formatCalendarBooked(state.result?.title ?? "your pick"),
      });
    }
    return;
  }

  await runCommand(coupleId, msg.collectionId, isReroll ? "reroll" : "done", {
    expectedRevision: msg.revisionNumber ?? undefined,
    weeklyResultId: msg.weeklyResultId ?? undefined,
  });
}

async function handleReply(coupleId: string, event: Extract<InboundEvent, { kind: "reply" }>) {
  const text = event.body.trim().toUpperCase();
  const action: "reroll" | "done" | null = text.startsWith("REROLL")
    ? "reroll"
    : text.startsWith("DONE")
      ? "done"
      : null;
  if (!action) return;

  const key = eventKey([event.messageId, text, event.senderId]);
  if (await alreadyProcessed(coupleId, key)) return;

  // Prefer the collection of the quoted message, if any.
  let collectionId: string | undefined;
  let expectedRevision: number | undefined;
  let weeklyResultId: string | undefined;
  if (event.quotedMessageId) {
    const quoted = await prisma.outboundMessage.findFirst({
      where: { coupleId, waMessageId: event.quotedMessageId },
    });
    if (quoted?.collectionId) {
      collectionId = quoted.collectionId;
      expectedRevision = quoted.revisionNumber ?? undefined;
      weeklyResultId = quoted.weeklyResultId ?? undefined;
    }
  }

  const collections = await prisma.collection.findMany({ where: { coupleId } });

  // Explicit collection token: "REROLL DATES"
  if (!collectionId) {
    const token = text.replace(/^(REROLL|DONE)\s*/, "").trim();
    if (token) {
      const match = collections.find((c) => c.name.toUpperCase() === token || c.kind.toUpperCase() === token);
      if (match) collectionId = match.id;
    }
  }

  // Still unknown: single collection => use it; otherwise ask.
  if (!collectionId) {
    if (collections.length === 1) {
      collectionId = collections[0]!.id;
    } else {
      await enqueue({ coupleId, kind: "reminder", body: formatAmbiguous(collections) });
      return;
    }
  }

  await runCommand(coupleId, collectionId, action, { expectedRevision, weeklyResultId });
}

async function runCommand(
  coupleId: string,
  collectionId: string,
  action: "reroll" | "done",
  ctx: { expectedRevision?: number; weeklyResultId?: string },
) {
  const meta = await collectionMeta(collectionId);
  if (!meta || meta.coupleId !== coupleId) return;

  // Guard: only act on the CURRENT weekly result, not a superseded/older one.
  const state = await selection.getCurrentState(coupleId, collectionId);
  if (ctx.weeklyResultId && state.result && state.result.weeklyResultId !== ctx.weeklyResultId) {
    logger.info({ collectionId }, "Ignoring WhatsApp command against superseded result");
    return;
  }

  if (action === "done") {
    await selection.markCompleted(coupleId, collectionId);
    await enqueue({
      coupleId,
      kind: "result",
      collectionId,
      body: `✅ Marked "${state.result?.title ?? "this week's pick"}" as completed. Nice!`,
    });
    return;
  }

  // reroll
  const res = await selection.reroll(coupleId, collectionId, {
    source: "whatsapp",
    expectedRevision: ctx.expectedRevision,
  });
  if (res.replaced) {
    await enqueue({
      coupleId,
      kind: "reroll",
      collectionId,
      weeklyResultId: res.state.result?.weeklyResultId,
      revisionNumber: res.state.result?.revision,
      body: formatReroll(res.state, meta),
    });
  } else if (res.reason === "no_alternative") {
    await enqueue({ coupleId, kind: "reroll", collectionId, body: formatNoAlternative(meta) });
  } else if (res.reason === "locked") {
    await enqueue({
      coupleId,
      kind: "reroll",
      collectionId,
      body: `🔒 This week's ${meta.name} pick is locked in — no rerolls.`,
    });
  }
  // "already_rerolled" => silent (a concurrent reroll already replaced it once)
}

export { formatReminder };
