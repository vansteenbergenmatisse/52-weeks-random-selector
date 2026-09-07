import { DateTime } from "luxon";
import { prisma } from "../../platform/db/prisma.js";
import { env, resendEnabled } from "../../platform/config/env.js";
import { logger } from "../../platform/logger/logger.js";
import { publish } from "../../platform/realtime/bus.js";
import { buildIcs } from "./ics.js";
import { enqueue } from "../whatsapp/outbox.js";
import { formatCalendarPrompt } from "../whatsapp/format.js";
import { ensureCurrentPeriod, getCurrentState, type CurrentState } from "../selection/service.js";

function parseEmails(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Bare email from a possibly-decorated from address ("Name <a@b.com>" → a@b.com). */
function fromEmail(): string {
  const m = env.CALENDAR_FROM_EMAIL.match(/<([^>]+)>/);
  return (m?.[1] ?? env.CALENDAR_FROM_EMAIL).trim();
}

export async function getCalendarStatus(coupleId: string) {
  const cfg = await prisma.calendarConfig.findUnique({ where: { coupleId } });
  const emails = parseEmails(cfg?.emails);
  return {
    enabled: cfg?.enabled ?? false,
    emails,
    durationMins: cfg?.durationMins ?? 120,
    resendReady: resendEnabled,
    configured: !!cfg?.enabled && emails.length > 0,
    note: resendEnabled
      ? "Invites are emailed to both of you; tap the attachment to add it to your calendar."
      : "Add RESEND_API_KEY on the server to actually send invites — dormant until then.",
  };
}

export async function updateCalendarConfig(
  coupleId: string,
  patch: { enabled?: boolean; emails?: string[]; durationMins?: number },
) {
  const data: Record<string, unknown> = {};
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.emails !== undefined) data.emails = JSON.stringify(patch.emails);
  if (patch.durationMins !== undefined) data.durationMins = patch.durationMins;
  await prisma.calendarConfig.upsert({
    where: { coupleId },
    update: data,
    create: {
      coupleId,
      enabled: patch.enabled ?? false,
      emails: JSON.stringify(patch.emails ?? []),
      durationMins: patch.durationMins ?? 120,
    },
  });
  publish({ type: "calendar.changed", coupleId });
  return getCalendarStatus(coupleId);
}

/** True when the couple has calendar enabled with at least one email. */
export async function calendarConfigured(coupleId: string): Promise<boolean> {
  const cfg = await prisma.calendarConfig.findUnique({ where: { coupleId } });
  return !!cfg?.enabled && parseEmails(cfg.emails).length > 0;
}

async function sendEmail(to: string[], subject: string, text: string, ics: string) {
  if (!resendEnabled) return { ok: false as const, reason: "no_email_provider" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.CALENDAR_FROM_EMAIL,
        to,
        subject,
        text,
        attachments: [{ filename: "our52.ics", content: Buffer.from(ics).toString("base64") }],
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Resend calendar email failed");
      return { ok: false as const, reason: "send_failed" };
    }
    return { ok: true as const };
  } catch (err) {
    logger.warn({ err: String(err) }, "Resend calendar email errored");
    return { ok: false as const, reason: "send_failed" };
  }
}

export type CalendarAddResult = { ok: boolean; reason?: string };

/** Email a .ics invite for the collection's CURRENT weekly pick to both partners. */
export async function addResultToCalendar(coupleId: string, collectionId: string): Promise<CalendarAddResult> {
  const cfg = await prisma.calendarConfig.findUnique({ where: { coupleId } });
  const emails = parseEmails(cfg?.emails);
  if (!cfg?.enabled || emails.length === 0) return { ok: false, reason: "not_configured" };

  const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!collection || collection.coupleId !== coupleId) return { ok: false, reason: "not_found" };

  const period = await ensureCurrentPeriod(collectionId);
  const result = await prisma.weeklyResult.findUnique({
    where: { periodId: period.id },
    include: { revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } },
  });
  const rev = result?.revisions[0];
  if (!result || !rev) return { ok: false, reason: "no_result" };
  if (result.calendarInvitedAt) return { ok: false, reason: "already" };

  // Atomically claim the invite BEFORE sending, so two near-simultaneous triggers
  // (both partners tapping 👍, or a 👍 racing the "Add to calendar" button) can't
  // each read calendarInvitedAt === null across the send await and both email.
  const claim = await prisma.weeklyResult.updateMany({
    where: { id: result.id, calendarInvitedAt: null },
    data: { calendarInvitedAt: new Date() },
  });
  if (claim.count !== 1) return { ok: false, reason: "already" };

  const start = period.scheduledAt;
  const end = new Date(start.getTime() + (cfg.durationMins ?? 120) * 60000);
  const ics = buildIcs({
    uid: `our52-${result.id}@our52`,
    start,
    end,
    title: `${collection.emoji} ${rev.snapTitle}`,
    description: rev.snapDescription,
    location: rev.snapLocation,
    organizerEmail: fromEmail(),
    attendeeEmails: emails,
  });
  const text = `Your ${collection.name.toLowerCase().replace(/s$/, "")} this week: ${rev.snapTitle}${
    rev.snapLocation ? ` at ${rev.snapLocation}` : ""
  }. Open the attached invite to add it to your calendar.`;
  const send = await sendEmail(emails, `Our 52 — ${rev.snapTitle}`, text, ics);
  if (!send.ok) {
    // Release the claim so the invite can be retried later.
    await prisma.weeklyResult.updateMany({ where: { id: result.id }, data: { calendarInvitedAt: null } });
    return { ok: false, reason: send.reason };
  }

  publish({ type: "calendar.changed", coupleId });
  return { ok: true };
}

/** After a weekly pick goes out, enqueue the "👍 to add to calendar?" message. */
export async function enqueueCalendarPromptIfConfigured(
  coupleId: string,
  collection: { id: string; name: string; kind: string; scheduleTimezone: string },
  state: CurrentState,
): Promise<void> {
  if (!state.result) return;
  if (!(await calendarConfigured(coupleId))) return;

  const period = await ensureCurrentPeriod(collection.id);
  const whenText = DateTime.fromJSDate(period.scheduledAt)
    .setZone(collection.scheduleTimezone)
    .toFormat("cccc d LLL, h:mm a");

  await enqueue({
    coupleId,
    kind: "calendar_prompt",
    collectionId: collection.id,
    weeklyResultId: state.result.weeklyResultId,
    revisionNumber: state.result.revision,
    body: formatCalendarPrompt(state, collection, whenText),
  });
}

export { getCurrentState };
