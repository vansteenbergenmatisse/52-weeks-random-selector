import { prisma } from "../../platform/db/prisma.js";
import { logger } from "../../platform/logger/logger.js";
import { env } from "../../platform/config/env.js";
import { publish } from "../../platform/realtime/bus.js";
import { FixtureAdapter, type WhatsAppAdapter, type WAStatus } from "./adapter.js";
import { handleInbound } from "./commands.js";
import { flushOutbox } from "./outbox.js";

const adapters = new Map<string, WhatsAppAdapter>();

async function syncStatus(coupleId: string, status: WAStatus, phone?: string, qr?: string | null) {
  await prisma.whatsAppSession.upsert({
    where: { coupleId },
    update: { status, phone: phone ?? undefined, lastQr: qr ?? undefined },
    create: { coupleId, status, phone: phone ?? null, lastQr: qr ?? null },
  });
  publish({ type: "whatsapp.changed", coupleId });
}

async function build(coupleId: string): Promise<WhatsAppAdapter> {
  if (env.WHATSAPP_ENABLED) {
    try {
      const { BaileysWhatsAppAdapter } = await import("./baileysAdapter.js");
      const a = new BaileysWhatsAppAdapter(coupleId);
      wire(a);
      return a;
    } catch (err) {
      logger.error({ err: String(err) }, "Failed to load Baileys WhatsApp adapter; using fixture");
    }
  }
  const fixture = new FixtureAdapter(coupleId);
  wire(fixture);
  return fixture;
}

function wire(adapter: WhatsAppAdapter) {
  adapter.onInbound(async (coupleId, event) => {
    try {
      await handleInbound(coupleId, event);
      // Push any queued replies immediately.
      await flushOutbox(adapter);
    } catch (err) {
      logger.error({ err: String(err), coupleId }, "Error handling inbound WhatsApp event");
    }
  });
  adapter.onStatusChange(async (status, phone) => {
    await syncStatus(adapter.coupleId, status, phone, adapter.lastQr());
  });
}

export async function getAdapter(coupleId: string): Promise<WhatsAppAdapter> {
  let a = adapters.get(coupleId);
  if (!a) {
    a = await build(coupleId);
    adapters.set(coupleId, a);
  }
  return a;
}

export async function connect(coupleId: string): Promise<void> {
  const a = await getAdapter(coupleId);
  await syncStatus(coupleId, "connecting");
  await a.connect();
  await syncStatus(coupleId, a.status(), undefined, a.lastQr());
}

export async function disconnect(coupleId: string): Promise<void> {
  const a = await getAdapter(coupleId);
  await a.disconnect();
  await syncStatus(coupleId, "disconnected");
}

/**
 * Activation gate for WhatsApp reminders. Reminders are opt-in and must not
 * fire until the couple has completed the one-time setup: a phone recipient,
 * a linked (connected) WhatsApp session, and an email for calendar invites.
 */
export interface Activation {
  hasPhone: boolean;
  linked: boolean;
  hasEmail: boolean;
  activated: boolean;
}

export async function getActivation(coupleId: string): Promise<Activation> {
  const [config, session, calendar] = await Promise.all([
    prisma.whatsAppConfig.findUnique({ where: { coupleId } }),
    prisma.whatsAppSession.findUnique({ where: { coupleId } }),
    prisma.calendarConfig.findUnique({ where: { coupleId } }),
  ]);
  const hasPhone = !!config && safeArr(config.recipients).length > 0;
  const linked = session?.status === "connected";
  const hasEmail = !!calendar && safeArr(calendar.emails).length > 0;
  return { hasPhone, linked, hasEmail, activated: hasPhone && linked && hasEmail };
}

/** True only when reminders are allowed to send for this couple. */
export async function isActivated(coupleId: string): Promise<boolean> {
  return (await getActivation(coupleId)).activated;
}

export async function getStatus(coupleId: string) {
  const session = await prisma.whatsAppSession.findUnique({ where: { coupleId } });
  const config = await prisma.whatsAppConfig.findUnique({ where: { coupleId } });
  const activation = await getActivation(coupleId);
  return {
    enabled: env.WHATSAPP_ENABLED,
    status: session?.status ?? "disconnected",
    phone: session?.phone ?? null,
    qr: session?.status === "qr" ? session.lastQr : null,
    deliveryMode: config?.deliveryMode ?? "individuals",
    groupId: config?.groupId ?? null,
    recipients: config ? safeArr(config.recipients) : [],
    ...activation,
    note: env.WHATSAPP_ENABLED
      ? "Baileys is an unofficial WhatsApp client (no browser needed). It can disconnect or be blocked, and requires an always-on host. No paid subscription is needed."
      : "WhatsApp is disabled (WHATSAPP_ENABLED=false). A fixture adapter is active; enable it and pair a phone in production.",
  };
}

function safeArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function updateConfig(
  coupleId: string,
  patch: { deliveryMode?: string; groupId?: string | null; recipients?: string[] },
) {
  const data: Record<string, unknown> = {};
  if (patch.deliveryMode) data.deliveryMode = patch.deliveryMode;
  if (patch.groupId !== undefined) data.groupId = patch.groupId;
  if (patch.recipients) data.recipients = JSON.stringify(patch.recipients);
  await prisma.whatsAppConfig.upsert({
    where: { coupleId },
    update: data,
    create: {
      coupleId,
      deliveryMode: patch.deliveryMode ?? "individuals",
      groupId: patch.groupId ?? null,
      recipients: JSON.stringify(patch.recipients ?? []),
    },
  });
  publish({ type: "whatsapp.changed", coupleId });
  return getStatus(coupleId);
}

/** Flush a couple's outbox using its adapter (used by API actions and worker). */
export async function flush(coupleId: string): Promise<void> {
  const a = await getAdapter(coupleId);
  if (a.status() !== "connected") return; // don't try to send while unpaired
  await flushOutbox(a);
}
