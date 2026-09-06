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
      const { RealWhatsAppAdapter } = await import("./realAdapter.js");
      const a = new RealWhatsAppAdapter(coupleId);
      wire(a);
      return a;
    } catch (err) {
      logger.error({ err: String(err) }, "Failed to load real WhatsApp adapter; using fixture");
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

export async function getStatus(coupleId: string) {
  const session = await prisma.whatsAppSession.findUnique({ where: { coupleId } });
  const config = await prisma.whatsAppConfig.findUnique({ where: { coupleId } });
  return {
    enabled: env.WHATSAPP_ENABLED,
    status: session?.status ?? "disconnected",
    phone: session?.phone ?? null,
    qr: session?.status === "qr" ? session.lastQr : null,
    deliveryMode: config?.deliveryMode ?? "individuals",
    groupId: config?.groupId ?? null,
    recipients: config ? safeArr(config.recipients) : [],
    note: env.WHATSAPP_ENABLED
      ? "whatsapp-web.js is an unofficial client. It can disconnect or be blocked, and requires an always-on host. No paid subscription is needed."
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
