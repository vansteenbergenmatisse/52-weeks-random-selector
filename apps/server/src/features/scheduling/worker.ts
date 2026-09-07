import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import { prisma } from "../../platform/db/prisma.js";
import { env } from "../../platform/config/env.js";
import { logger } from "../../platform/logger/logger.js";
import { cycleIsComplete } from "../../shared/time.js";
import * as selection from "../selection/service.js";
import * as whatsapp from "../whatsapp/manager.js";
import * as calendar from "../calendar/service.js";
import { enqueueBroadcast } from "../whatsapp/outbox.js";
import { formatResultMessage, formatReminder } from "../whatsapp/format.js";

/** Claim a job key; returns false if it was already claimed (idempotent). */
async function claimJob(jobKey: string, type: string, status = "done"): Promise<boolean> {
  try {
    await prisma.jobRun.create({ data: { jobKey, type, status } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

/** The notification instant for a period (defaults to the selection schedule). */
function notifyInstant(
  collection: {
    scheduleWeekday: number;
    scheduleTime: string;
    scheduleTimezone: string;
    notifyWeekday: number | null;
    notifyTime: string | null;
    notifyTimezone: string | null;
  },
  period: { periodStart: Date; periodEnd: Date; scheduledAt: Date },
): Date {
  const overridden =
    collection.notifyWeekday !== null || collection.notifyTime !== null || collection.notifyTimezone !== null;
  if (!overridden) return period.scheduledAt;

  const tz = collection.notifyTimezone ?? collection.scheduleTimezone;
  const weekday = collection.notifyWeekday ?? collection.scheduleWeekday;
  const [h, m] = (collection.notifyTime ?? collection.scheduleTime).split(":").map(Number);
  const target = weekday === 0 ? 7 : weekday;

  // Find the matching weekday/time inside this period's week window. The loop is
  // anchored at startOf("day") of periodStart (up to ~24h before periodStart),
  // and the window [periodStart, periodEnd) spans 8 calendar days, so we must
  // check i=0..7 — stopping at 6 misses a same-weekday, earlier-time-of-day
  // notify instant (it lands on day offset 7) and silently falls back to the
  // draw instant.
  let dt = DateTime.fromJSDate(period.periodStart, { zone: tz }).startOf("day");
  for (let i = 0; i <= 7; i++) {
    const cand = dt.plus({ days: i }).set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 });
    if (cand.weekday === target && cand.toMillis() >= period.periodStart.getTime() && cand.toMillis() < period.periodEnd.getTime()) {
      return cand.toUTC().toJSDate();
    }
  }
  return period.scheduledAt;
}

/**
 * One scheduling tick. For each collection:
 *   1. If auto-selection is due and no result exists, draw (persisted first).
 *   2. If notification is due, send the saved result, or a reminder if manual
 *      mode has produced nothing yet.
 * Both steps are guarded by JobRun keys so restarts never duplicate work, and
 * only the CURRENT period is processed (no backlog of missed weeks).
 */
export async function tick(now: Date = new Date()): Promise<void> {
  const collections = await prisma.collection.findMany();
  for (const collection of collections) {
    try {
      if (!collection.cycleStartDate) continue;
      if (cycleIsComplete(collection.cycleStartDate, collection.scheduleTimezone, now)) continue;

      const period = await selection.ensureCurrentPeriod(collection.id);
      const dueForSelection = collection.autoSelect && now.getTime() >= period.scheduledAt.getTime();
      const notifyAt = notifyInstant(collection, period);
      // Reminders are opt-in: never fire until the couple has completed WhatsApp
      // activation (phone + linked session + email), even if notify is toggled on.
      const notifyDue = collection.notifyEnabled && now.getTime() >= notifyAt.getTime();
      const dueForNotify = notifyDue && (await whatsapp.isActivated(collection.coupleId));

      // 1) Selection first, so a co-due notification can carry the fresh result.
      // No JobRun claim here: concurrency is already handled by unique(periodId)
      // inside spin(), and an empty pool must stay RETRYABLE — a claim written
      // before spin() would survive an empty-pool throw and permanently skip the
      // week's pick even after ideas are added. Instead we only draw when the
      // pool has something, and any transient spin error is caught below and
      // retried on the next tick.
      if (dueForSelection) {
        const existing = await prisma.weeklyResult.findUnique({ where: { periodId: period.id } });
        if (!existing) {
          const available = await prisma.entry.count({
            where: { collectionId: collection.id, deletedAt: null, status: "available" },
          });
          if (available > 0) {
            const res = await selection.spin(collection.coupleId, collection.id, { source: "auto" });
            if (!res.created) {
              logger.info({ collectionId: collection.id }, "Auto-select found existing result (race)");
            }
          }
        }
      }

      // 2) Notification. The JobRun claim is written BEFORE the enqueue so a
      // concurrent tick can't double-send, but if the essential enqueue throws
      // before the outbox row is durably persisted we roll the claim back so the
      // notification retries on a later tick (otherwise the week's pick/reminder
      // is silently dropped forever).
      if (dueForNotify && (await claimJob(`notify:${period.id}`, "notify"))) {
        const state = await selection.getCurrentState(collection.coupleId, collection.id);
        try {
          if (state.result) {
            await enqueueBroadcast({
              coupleId: collection.coupleId,
              kind: "result",
              collectionId: collection.id,
              weeklyResultId: state.result.weeklyResultId,
              revisionNumber: state.result.revision,
              body: formatResultMessage(state, collection),
            });
          } else {
            await enqueueBroadcast({
              coupleId: collection.coupleId,
              kind: "reminder",
              collectionId: collection.id,
              body: formatReminder(collection),
            });
          }
        } catch (err) {
          await prisma.jobRun.deleteMany({ where: { jobKey: `notify:${period.id}` } });
          throw err;
        }
        // Calendar prompt + flush are best-effort: the result/reminder is already
        // durably enqueued, so their failure must NOT un-claim the notify job
        // (that would re-enqueue a duplicate result next tick).
        try {
          if (state.result) {
            await calendar.enqueueCalendarPromptIfConfigured(collection.coupleId, collection, state);
          }
          await whatsapp.flush(collection.coupleId);
        } catch (err) {
          logger.warn(
            { err: String(err), collectionId: collection.id },
            "Calendar prompt / outbox flush failed (result already enqueued)",
          );
        }
      }
    } catch (err) {
      logger.error({ err: String(err), collectionId: collection.id }, "Worker tick error for collection");
    }
  }

  // Keep paired WhatsApp sessions alive and drain any stranded outbox rows.
  try {
    await whatsapp.healConnections();
  } catch (err) {
    logger.error({ err: String(err) }, "WhatsApp heal failed");
  }
}

/**
 * Full scheduling startup: reconnect any previously-paired WhatsApp sessions
 * (best effort) and begin the tick loop. Shared by the standalone worker
 * process and the API process (single-service SQLite deploy runs it inline).
 */
export async function startScheduling(): Promise<void> {
  if (env.WHATSAPP_ENABLED) {
    const sessions = await prisma.whatsAppSession.findMany({ where: { status: "connected" } });
    for (const s of sessions) {
      whatsapp.connect(s.coupleId, s.userId).catch((err) =>
        logger.warn({ err: String(err), userId: s.userId }, "WhatsApp reconnect failed"),
      );
    }
  }
  startWorkerLoop(env.WORKER_TICK_SECONDS);
}

let timer: NodeJS.Timeout | null = null;

export function startWorkerLoop(intervalSeconds: number): void {
  logger.info({ intervalSeconds }, "Scheduling worker started");
  const run = () => {
    tick().catch((err) => logger.error({ err: String(err) }, "Worker tick failed"));
  };
  run();
  timer = setInterval(run, intervalSeconds * 1000);
}

export function stopWorkerLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
