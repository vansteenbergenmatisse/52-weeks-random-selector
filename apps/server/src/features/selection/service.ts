import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../platform/db/prisma.js";
import type { Tx } from "../../platform/db/prisma.js";
import { Errors } from "../../shared/errors.js";
import { publish } from "../../platform/realtime/bus.js";
import { assertCollectionInCouple } from "../collections/service.js";
import { currentWeekIndex, weekBounds } from "../../shared/time.js";

export type SelectionSource = "web" | "whatsapp" | "auto";

/** Pick a uniformly random element (equal probability), or null if empty. */
function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[randomInt(items.length)]!;
}

async function eligibleEntryIds(tx: Tx, collectionId: string, exclude: Set<string>): Promise<string[]> {
  const rows = await tx.entry.findMany({
    where: { collectionId, deletedAt: null, status: "available" },
    select: { id: true },
  });
  return rows.map((r) => r.id).filter((id) => !exclude.has(id));
}

/** Ensure a WeeklyPeriod row exists for the collection's current week. */
export async function ensureCurrentPeriod(collectionId: string) {
  const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
  if (!collection.cycleStartDate) throw Errors.conflict("Collection has no cycle start configured");

  const weekIndex = currentWeekIndex(collection.cycleStartDate, collection.scheduleTimezone);
  if (weekIndex < 1) {
    // Cycle hasn't started; treat week 1 as the active pre-start period.
    const bounds = weekBounds(collection.cycleStartDate, collection.scheduleTimezone, 1);
    return upsertPeriod(collection.id, collection.cycleIndex, 1, bounds);
  }
  const bounds = weekBounds(collection.cycleStartDate, collection.scheduleTimezone, weekIndex);
  return upsertPeriod(collection.id, collection.cycleIndex, weekIndex, bounds);
}

async function upsertPeriod(
  collectionId: string,
  cycleIndex: number,
  weekIndex: number,
  bounds: { start: Date; end: Date; scheduledAt: Date },
) {
  return prisma.weeklyPeriod.upsert({
    where: { collectionId_cycleIndex_weekIndex: { collectionId, cycleIndex, weekIndex } },
    update: {},
    create: {
      collectionId,
      cycleIndex,
      weekIndex,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      scheduledAt: bounds.scheduledAt,
    },
  });
}

function snapshotData(entry: {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  location: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  imdbId: string | null;
  contributor: { displayName: string };
}) {
  return {
    snapTitle: entry.title,
    snapDescription: entry.description,
    snapEmoji: entry.emoji,
    snapContributor: entry.contributor.displayName,
    snapPosterPath: entry.posterPath,
    snapBackdropPath: entry.backdropPath,
    snapLocation: entry.location,
    snapImdbId: entry.imdbId,
  };
}

/**
 * Load the current period's result together with whether its latest pick is
 * still a LIVE pool entry (present and not soft-deleted). A pick that was
 * removed from the pool must never keep showing as "this week's pick".
 */
async function loadCurrentResult(periodId: string) {
  const result = await prisma.weeklyResult.findUnique({
    where: { periodId },
    include: {
      revisions: {
        orderBy: { revisionNumber: "desc" },
        take: 1,
        include: { entry: { select: { deletedAt: true } } },
      },
    },
  });
  const pick = result?.revisions[0] ?? null;
  const pickLive = !!(pick && pick.entryId && pick.entry && pick.entry.deletedAt === null);
  return { result, pick, pickLive };
}

/**
 * Perform (or reveal) the weekly selection. The server picks and persists the
 * winner BEFORE the client animates. Concurrent callers converge on ONE result
 * thanks to the unique(periodId) constraint.
 *
 * Returns `created: true` only for the call that actually drew, so the caller
 * can fire notifications exactly once.
 */
export async function spin(
  coupleId: string,
  collectionId: string,
  opts: { userId?: string; source?: SelectionSource } = {},
): Promise<{ created: boolean; state: CurrentState }> {
  await assertCollectionInCouple(collectionId, coupleId);
  const period = await ensureCurrentPeriod(collectionId);

  // Fast path: a result already exists. Reveal it ONLY if its pick is still a
  // live pool entry. If the pick was removed from the pool, discard this week's
  // stale result and draw a fresh one — so an emptied pool never replays a
  // ghost pick. (Past weeks are untouched: spin only ever acts on the current
  // period; history reads immutable snapshots separately.)
  const { result: existing, pickLive } = await loadCurrentResult(period.id);
  if (existing) {
    if (pickLive) return { created: false, state: await getCurrentState(coupleId, collectionId) };
    await prisma.weeklyResult.delete({ where: { id: existing.id } });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const ids = await eligibleEntryIds(tx, collectionId, new Set());
      const chosenId = pickRandom(ids);
      if (!chosenId) throw Errors.conflict("No ideas available to pick from");

      const entry = await tx.entry.findUniqueOrThrow({
        where: { id: chosenId },
        include: { contributor: true },
      });

      const result = await tx.weeklyResult.create({
        data: { periodId: period.id, collectionId, currentRevisionNumber: 1 },
      });
      await tx.resultRevision.create({
        data: {
          weeklyResultId: result.id,
          revisionNumber: 1,
          entryId: entry.id,
          source: opts.source ?? "web",
          reason: opts.source === "auto" ? "auto" : "spin",
          createdByUserId: opts.userId ?? null,
          ...snapshotData(entry),
        },
      });
      await tx.entry.update({ where: { id: entry.id }, data: { status: "selected" } });
    });
  } catch (e) {
    // Lost the race: another spin created the result first. Reveal theirs.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { created: false, state: await getCurrentState(coupleId, collectionId) };
    }
    throw e;
  }

  publish({ type: "result.changed", coupleId, collectionId });
  publish({ type: "entries.changed", coupleId, collectionId });
  return { created: true, state: await getCurrentState(coupleId, collectionId) };
}

/**
 * Rerolling is intentionally disabled: a week's pick is LOCKED once it's decided
 * — by whoever spins first, or by the Sunday auto-spin. Neither partner can
 * change it afterwards, so the choice for the week is final and identical for
 * both. Enforced here on the server so no client (web or WhatsApp) can bypass it.
 * Kept as a no-op (rather than deleted) so existing routes/callers stay stable.
 */
export async function reroll(
  coupleId: string,
  collectionId: string,
  _opts: { userId?: string; source?: SelectionSource; expectedRevision?: number } = {},
): Promise<{ replaced: boolean; reason?: string; state: CurrentState }> {
  await assertCollectionInCouple(collectionId, coupleId);
  return { replaced: false, reason: "locked", state: await getCurrentState(coupleId, collectionId) };
}

export async function markCompleted(coupleId: string, collectionId: string) {
  await assertCollectionInCouple(collectionId, coupleId);
  const period = await ensureCurrentPeriod(collectionId);
  const result = await prisma.weeklyResult.findUnique({
    where: { periodId: period.id },
    include: { revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } },
  });
  if (!result) throw Errors.conflict("There is no result to complete yet");

  await prisma.$transaction(async (tx) => {
    await tx.weeklyResult.update({ where: { id: result.id }, data: { completedAt: new Date() } });
    const entryId = result.revisions[0]?.entryId;
    if (entryId) {
      // Complete only the picked entry. Any other copies of the same movie stay
      // in the pool — watching it once shouldn't sweep the film away, so it can
      // still come up again for a rerun.
      await tx.entry.update({
        where: { id: entryId },
        data: { status: "completed" },
      });
    }
  });
  publish({ type: "result.changed", coupleId, collectionId });
  publish({ type: "entries.changed", coupleId, collectionId });
  return getCurrentState(coupleId, collectionId);
}

// ── Read models ─────────────────────────────────────────────────────

export interface CurrentState {
  collectionId: string;
  weekIndex: number;
  cycleIndex: number;
  periodStart: string;
  hasResult: boolean;
  completed: boolean;
  availableCount: number;
  revision: number;
  result: ResultView | null;
  /** "spin" if no result yet (manual draw needed), else "reveal". */
  action: "spin" | "reveal";
}

export interface ResultView {
  weeklyResultId: string;
  revision: number;
  title: string;
  description: string | null;
  emoji: string | null;
  location: string | null;
  contributor: string;
  posterPath: string | null;
  backdropPath: string | null;
  imdbId: string | null;
  entryId: string | null;
  reason: string;
}

export async function getCurrentState(coupleId: string, collectionId: string): Promise<CurrentState> {
  await assertCollectionInCouple(collectionId, coupleId);
  const period = await ensureCurrentPeriod(collectionId);
  const { result, pick, pickLive } = await loadCurrentResult(period.id);
  const availableCount = await prisma.entry.count({
    where: { collectionId, deletedAt: null, status: "available" },
  });

  // Only surface a result whose pick is still in the pool. A removed pick (its
  // entry soft-deleted) leaves the week re-spinnable instead of replaying a ghost.
  const show = !!(result && pick && pickLive);

  let view: ResultView | null = null;
  if (show) {
    const r = pick!;
    view = {
      weeklyResultId: result!.id,
      revision: result!.currentRevisionNumber,
      title: r.snapTitle,
      description: r.snapDescription,
      emoji: r.snapEmoji,
      location: r.snapLocation,
      contributor: r.snapContributor,
      posterPath: r.snapPosterPath,
      backdropPath: r.snapBackdropPath,
      imdbId: r.snapImdbId,
      entryId: r.entryId,
      reason: r.reason,
    };
  }

  return {
    collectionId,
    weekIndex: period.weekIndex,
    cycleIndex: period.cycleIndex,
    periodStart: period.periodStart.toISOString(),
    hasResult: show,
    completed: show ? !!result!.completedAt : false,
    availableCount,
    revision: show ? result!.currentRevisionNumber : 0,
    result: view,
    action: show ? "reveal" : "spin",
  };
}

export async function getHistory(coupleId: string, collectionId: string) {
  await assertCollectionInCouple(collectionId, coupleId);
  const periods = await prisma.weeklyPeriod.findMany({
    where: { collectionId },
    orderBy: [{ cycleIndex: "desc" }, { weekIndex: "desc" }],
    include: {
      result: { include: { revisions: { orderBy: { revisionNumber: "asc" } } } },
    },
  });
  return periods
    .filter((p) => p.result)
    .map((p) => {
      const r = p.result!;
      const revs = r.revisions;
      const currentRev = revs.find((x) => x.revisionNumber === r.currentRevisionNumber) ?? revs.at(-1)!;
      return {
        periodId: p.id,
        cycleIndex: p.cycleIndex,
        weekIndex: p.weekIndex,
        periodStart: p.periodStart.toISOString(),
        completed: !!r.completedAt,
        completedAt: r.completedAt?.toISOString() ?? null,
        current: {
          title: currentRev.snapTitle,
          emoji: currentRev.snapEmoji,
          contributor: currentRev.snapContributor,
          posterPath: currentRev.snapPosterPath,
        },
        rerolls: revs.length - 1,
        revisions: revs.map((x) => ({
          revisionNumber: x.revisionNumber,
          title: x.snapTitle,
          emoji: x.snapEmoji,
          contributor: x.snapContributor,
          reason: x.reason,
          source: x.source,
          createdAt: x.createdAt.toISOString(),
        })),
      };
    });
}

/** Begin a fresh 52-week cycle without deleting history or recycling entries. */
export async function startNewCycle(coupleId: string, collectionId: string) {
  const collection = await assertCollectionInCouple(collectionId, coupleId);
  const { firstScheduledInstant } = await import("../../shared/time.js");
  const nextStart = firstScheduledInstant({
    weekday: collection.scheduleWeekday,
    time: collection.scheduleTime,
    timezone: collection.scheduleTimezone,
  });
  const updated = await prisma.collection.update({
    where: { id: collectionId },
    data: { cycleIndex: collection.cycleIndex + 1, cycleStartDate: nextStart },
  });
  publish({ type: "collection.changed", coupleId, collectionId });
  publish({ type: "result.changed", coupleId, collectionId });
  return updated;
}
