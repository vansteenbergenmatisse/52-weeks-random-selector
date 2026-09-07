import { prisma } from "../../platform/db/prisma.js";
import { logger } from "../../platform/logger/logger.js";
import { env } from "../../platform/config/env.js";
import { publish } from "../../platform/realtime/bus.js";
import { FixtureAdapter, type WhatsAppAdapter, type WAStatus } from "./adapter.js";
import { handleInbound } from "./commands.js";
import {
  coupleMembers,
  enqueueDirect,
  flushOutboxForUser,
  reconcileOutboxForUser,
} from "./outbox.js";

// One adapter per USER — each partner links their own phone independently.
const adapters = new Map<string, WhatsAppAdapter>();

async function syncStatus(
  coupleId: string,
  userId: string,
  status: WAStatus,
  phone?: string,
  qr?: string | null,
) {
  await prisma.whatsAppSession.upsert({
    where: { userId },
    update: { status, phone: phone ?? undefined, lastQr: qr ?? undefined },
    create: { coupleId, userId, status, phone: phone ?? null, lastQr: qr ?? null },
  });
  publish({ type: "whatsapp.changed", coupleId });
}

async function build(coupleId: string, userId: string): Promise<WhatsAppAdapter> {
  if (env.WHATSAPP_ENABLED) {
    try {
      const { BaileysWhatsAppAdapter } = await import("./baileysAdapter.js");
      const a = new BaileysWhatsAppAdapter(coupleId, userId);
      wire(a);
      return a;
    } catch (err) {
      logger.error({ err: String(err) }, "Failed to load Baileys WhatsApp adapter; using fixture");
    }
  }
  const fixture = new FixtureAdapter(coupleId, userId);
  wire(fixture);
  return fixture;
}

function wire(adapter: WhatsAppAdapter) {
  adapter.onInbound(async (coupleId, event) => {
    try {
      await handleInbound(coupleId, event);
      // Push any queued replies immediately, on whichever session must send them.
      await flush(coupleId);
    } catch (err) {
      logger.error({ err: String(err), coupleId }, "Error handling inbound WhatsApp event");
    }
  });
  adapter.onStatusChange(async (status, phone) => {
    await syncStatus(adapter.coupleId, adapter.userId, status, phone, adapter.lastQr());
  });
}

export async function getAdapter(coupleId: string, userId: string): Promise<WhatsAppAdapter> {
  let a = adapters.get(userId);
  if (!a) {
    a = await build(coupleId, userId);
    adapters.set(userId, a);
  }
  return a;
}

export async function connect(coupleId: string, userId: string): Promise<void> {
  const a = await getAdapter(coupleId, userId);
  await syncStatus(coupleId, userId, "connecting");
  await a.connect();
  await syncStatus(coupleId, userId, a.status(), undefined, a.lastQr());
}

export async function disconnect(coupleId: string, userId: string): Promise<void> {
  const a = await getAdapter(coupleId, userId);
  await a.disconnect();
  await syncStatus(coupleId, userId, "disconnected");
}

/**
 * Activation gate for WhatsApp reminders. Reminders are mutual — each partner is
 * reminded FROM the other's phone — so nothing can send until BOTH partners have
 * linked their own WhatsApp. `activated` is true only when both sessions are live.
 */
export interface Activation {
  activated: boolean;
  linkedCount: number;
  total: number;
}

export async function getActivation(coupleId: string): Promise<Activation> {
  const members = await coupleMembers(coupleId);
  const linkedCount = members.filter((m) => m.connected).length;
  return { activated: members.length === 2 && linkedCount === 2, linkedCount, total: members.length };
}

/** True only when reminders are allowed to send (both partners linked). */
export async function isActivated(coupleId: string): Promise<boolean> {
  return (await getActivation(coupleId)).activated;
}

const NOTE_ON =
  "Baileys is an unofficial WhatsApp client (no browser needed). Each of you links your own phone; reminders are sent between you once both are linked.";
const NOTE_OFF =
  "WhatsApp is disabled (WHATSAPP_ENABLED=false). A fixture adapter is active; enable it on the server to link a phone.";

/** Per-user status: the logged-in user's own link + the partner's link state. */
export async function getStatus(coupleId: string, userId: string) {
  const [session, members, activation] = await Promise.all([
    prisma.whatsAppSession.findUnique({ where: { userId } }),
    coupleMembers(coupleId),
    getActivation(coupleId),
  ]);
  const partner = members.find((m) => m.userId !== userId) ?? null;
  return {
    enabled: env.WHATSAPP_ENABLED,
    you: {
      status: session?.status ?? "disconnected",
      phone: session?.phone ?? null,
      qr: session?.status === "qr" ? session.lastQr : null,
      linked: session?.status === "connected",
    },
    partner: partner ? { name: partner.displayName, linked: partner.connected } : null,
    activated: activation.activated,
    note: env.WHATSAPP_ENABLED ? NOTE_ON : NOTE_OFF,
  };
}

export interface TestResult {
  ok: boolean;
  reason?: string;
  target?: string; // human label of who the test was sent to
}

/**
 * Send a test message FROM the logged-in user's WhatsApp. Goes to the partner
 * (the real reminder path) when they're linked, otherwise to the user's own
 * number as a self-check. Requires the sender's session to be connected.
 */
export async function sendTest(coupleId: string, userId: string): Promise<TestResult> {
  const members = await coupleMembers(coupleId);
  const me = members.find((m) => m.userId === userId);
  const partner = members.find((m) => m.userId !== userId) ?? null;
  if (!me) return { ok: false, reason: "not_a_member" };
  if (!me.connected) return { ok: false, reason: "not_linked" };

  const recipient =
    partner && partner.connected && partner.phone
      ? { phone: partner.phone, who: partner.displayName }
      : me.phone
        ? { phone: me.phone, who: "yourself" }
        : null;
  if (!recipient) return { ok: false, reason: "no_number" };

  await enqueueDirect({
    coupleId,
    senderUserId: me.userId,
    chatId: recipient.phone,
    kind: "test",
    body: `✅ Our 52 test message — WhatsApp delivery is working (from ${me.displayName}).`,
  });
  const adapter = await getAdapter(coupleId, me.userId);
  if (adapter.status() === "connected") await flushOutboxForUser(me.userId, adapter);
  return { ok: true, target: recipient.who };
}

/** Flush every member's outbox on their own session (used by API actions + worker). */
export async function flush(coupleId: string): Promise<void> {
  const members = await coupleMembers(coupleId);
  for (const m of members) {
    if (!m.connected) continue;
    const a = await getAdapter(coupleId, m.userId);
    if (a.status() !== "connected") continue;
    await reconcileOutboxForUser(m.userId, a);
  }
}

/**
 * Periodic self-heal, called each worker tick. For every user session marked
 * "connected", make sure the live adapter really is connected — reconnect if it
 * drifted — and reconcile that user's outbox so stragglers eventually send.
 */
export async function healConnections(): Promise<void> {
  if (!env.WHATSAPP_ENABLED) return;
  const sessions = await prisma.whatsAppSession.findMany({ where: { status: "connected" } });
  for (const s of sessions) {
    try {
      const a = await getAdapter(s.coupleId, s.userId);
      if (a.status() !== "connected") await a.connect();
      else await reconcileOutboxForUser(s.userId, a);
    } catch (err) {
      logger.warn({ err: String(err), userId: s.userId }, "WhatsApp heal failed");
    }
  }
}
