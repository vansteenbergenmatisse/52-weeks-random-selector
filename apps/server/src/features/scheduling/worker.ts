import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import { prisma } from "../../platform/db/prisma.js";
import { logger } from "../../platform/logger/logger.js";
import { cycleIsComplete } from "../../shared/time.js";
import * as selection from "../selection/service.js";
import * as whatsapp from "../whatsapp/manager.js";
import * as calendar from "../calendar/service.js";
import { enqueue } from "../whatsapp/outbox.js";
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

  // Find the matching weekday/time inside this period's week window.
  let dt = DateTime.fromJSDate(period.periodStart, { zone: tz }).startOf("day");
  for (let i = 0; i < 7; i++) {
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
      const dueForNotify = collection.notifyEnabled && now.getTime() >= notifyAt.getTime();

      // 1) Selection first, so a co-due notification can carry the fresh result.
      if (dueForSelection) {
        const existing = await prisma.weeklyResult.findUnique({ where: { periodId: period.id } });
        if (!existing && (await claimJob(`select:${period.id}`, "select"))) {
          const res = await selection.spin(collection.coupleId, collection.id, { source: "auto" });
          if (!res.created) {
            logger.info({ collectionId: collection.id }, "Auto-select found existing result (race)");
          }
        }
      }

      // 2) Notification.
      if (dueForNotify && (await claimJob(`notify:${period.id}`, "notify"))) {
        const state = await selection.getCurrentState(collection.coupleId, collection.id);
        if (state.result) {
          await enqueue({
            coupleId: collection.coupleId,
            kind: "result",
            collectionId: collection.id,
            weeklyResultId: state.result.weeklyResultId,
            revisionNumber: state.result.revision,
            body: formatResultMessage(state, collection),
          });
          await calendar.enqueueCalendarPromptIfConfigured(collection.coupleId, collection, state);
        } else {
          await enqueue({
            coupleId: collection.coupleId,
            kind: "reminder",
            collectionId: collection.id,
            body: formatReminder(collection),
          });
        }
        await whatsapp.flush(collection.coupleId);
      }
    } catch (err) {
      logger.error({ err: String(err), collectionId: collection.id }, "Worker tick error for collection");
    }
  }
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
