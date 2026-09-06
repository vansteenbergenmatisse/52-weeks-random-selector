import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../platform/db/prisma.js";
import { env } from "../../platform/config/env.js";
import { Errors } from "../../shared/errors.js";
import { firstScheduledInstant } from "../../shared/time.js";
import { publish } from "../../platform/realtime/bus.js";

type TxLike = PrismaClient | Prisma.TransactionClient;

const COLLECTION_COLORS = ["red", "blue", "purple", "charcoal"] as const;

export async function createDefaultCollections(tx: TxLike, coupleId: string): Promise<void> {
  await createCollectionInternal(tx, coupleId, {
    name: "Dates",
    kind: "dates",
    emoji: "🌅",
    colorKey: "red",
  });
  await createCollectionInternal(tx, coupleId, {
    name: "Movies",
    kind: "movies",
    emoji: "🎬",
    colorKey: "blue",
  });
}

async function createCollectionInternal(
  tx: TxLike,
  coupleId: string,
  input: { name: string; kind: string; emoji?: string; colorKey?: string; targetPerPerson?: number },
) {
  const timezone = env.DEFAULT_TIMEZONE;
  const weekday = env.DEFAULT_WEEKDAY;
  const time = env.DEFAULT_TIME;
  const cycleStartDate = firstScheduledInstant({ weekday, time, timezone });

  return tx.collection.create({
    data: {
      coupleId,
      name: input.name.trim(),
      kind: input.kind,
      emoji: input.emoji ?? "🎲",
      colorKey: input.colorKey ?? "charcoal",
      targetPerPerson: input.targetPerPerson ?? 26,
      scheduleWeekday: weekday,
      scheduleTime: time,
      scheduleTimezone: timezone,
      cycleStartDate,
      cycleIndex: 1,
    },
  });
}

export async function assertCollectionInCouple(collectionId: string, coupleId: string) {
  const c = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!c || c.coupleId !== coupleId) throw Errors.notFound("Collection not found");
  return c;
}

export async function listCollections(coupleId: string) {
  const collections = await prisma.collection.findMany({
    where: { coupleId },
    orderBy: { createdAt: "asc" },
  });
  // Attach lightweight counts for the tab UI.
  const withCounts = await Promise.all(
    collections.map(async (c) => {
      const available = await prisma.entry.count({
        where: { collectionId: c.id, deletedAt: null, status: "available" },
      });
      const total = await prisma.entry.count({ where: { collectionId: c.id, deletedAt: null } });
      return { ...c, availableCount: available, totalCount: total };
    }),
  );
  return withCounts;
}

export async function createCollection(
  coupleId: string,
  input: { name: string; emoji?: string; colorKey?: string; targetPerPerson?: number },
) {
  if (!input.name.trim()) throw Errors.badRequest("Name is required");
  const idx = (await prisma.collection.count({ where: { coupleId } })) % COLLECTION_COLORS.length;
  const created = await createCollectionInternal(prisma, coupleId, {
    name: input.name,
    kind: "custom",
    emoji: input.emoji ?? "🎲",
    colorKey: input.colorKey ?? COLLECTION_COLORS[idx]!,
    targetPerPerson: input.targetPerPerson,
  });
  publish({ type: "collection.changed", coupleId });
  return created;
}

const SETTABLE = [
  "name",
  "emoji",
  "colorKey",
  "targetPerPerson",
  "autoSelect",
  "scheduleWeekday",
  "scheduleTime",
  "scheduleTimezone",
  "notifyEnabled",
  "notifyWeekday",
  "notifyTime",
  "notifyTimezone",
] as const;

export async function updateCollection(
  coupleId: string,
  collectionId: string,
  patch: Record<string, unknown>,
) {
  await assertCollectionInCouple(collectionId, coupleId);
  const data: Record<string, unknown> = {};
  for (const key of SETTABLE) {
    if (key in patch) data[key] = patch[key];
  }
  const updated = await prisma.collection.update({ where: { id: collectionId }, data });
  publish({ type: "collection.changed", coupleId, collectionId });
  return updated;
}
