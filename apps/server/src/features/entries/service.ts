import { prisma } from "../../platform/db/prisma.js";
import { Errors } from "../../shared/errors.js";
import { publish } from "../../platform/realtime/bus.js";
import { assertCollectionInCouple } from "../collections/service.js";
import { pickEmoji, pickEmojis } from "./emoji.js";
import { getImdbId } from "../movies/tmdb.js";

export interface EntryInput {
  title: string;
  description?: string | null;
  emoji?: string | null;
  location?: string | null;
  cost?: string | null;
  prep?: string | null;
  tmdbId?: number | null;
  imdbId?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseYear?: number | null;
}

function publicEntry(e: {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  location: string | null;
  cost: string | null;
  prep: string | null;
  status: string;
  contributorId: string;
  tmdbId: number | null;
  imdbId: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseYear: number | null;
  contributor?: { displayName: string; avatarUrl: string | null } | null;
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    emoji: e.emoji,
    location: e.location,
    cost: e.cost,
    prep: e.prep,
    status: e.status,
    contributorId: e.contributorId,
    contributorName: e.contributor?.displayName ?? "",
    contributorAvatar: e.contributor?.avatarUrl ?? null,
    tmdbId: e.tmdbId,
    imdbId: e.imdbId,
    posterPath: e.posterPath,
    backdropPath: e.backdropPath,
    releaseYear: e.releaseYear,
  };
}

export async function listEntries(coupleId: string, collectionId: string) {
  await assertCollectionInCouple(collectionId, coupleId);
  const entries = await prisma.entry.findMany({
    where: { collectionId, deletedAt: null },
    include: { contributor: true },
    orderBy: { createdAt: "asc" },
  });
  return entries.map(publicEntry);
}

export async function getProgress(coupleId: string, collectionId: string) {
  const collection = await assertCollectionInCouple(collectionId, coupleId);
  const memberships = await prisma.membership.findMany({
    where: { coupleId },
    include: { user: true },
    orderBy: { joinedAt: "asc" },
  });
  const rows = await Promise.all(
    memberships.map(async (m) => {
      // Count only what's actually in the pool right now (available) so the
      // number matches the cards shown — selected/completed/watched are excluded.
      const count = await prisma.entry.count({
        where: { collectionId, contributorId: m.userId, deletedAt: null, status: "available" },
      });
      return {
        userId: m.userId,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        added: count,
        target: collection.targetPerPerson,
      };
    }),
  );
  return { target: collection.targetPerPerson, contributors: rows };
}

export async function createEntry(
  coupleId: string,
  collectionId: string,
  userId: string,
  input: EntryInput,
) {
  const collection = await assertCollectionInCouple(collectionId, coupleId);
  const title = input.title?.trim();
  if (!title) throw Errors.badRequest("Title is required");

  // A movie can only be in the pool once. If this TMDB title is already here
  // (not watched, not deleted), return that entry instead of adding a duplicate.
  if (collection.kind === "movies" && input.tmdbId != null) {
    const existing = await prisma.entry.findFirst({
      where: {
        collectionId,
        tmdbId: input.tmdbId,
        deletedAt: null,
        status: { in: ["available", "selected"] },
      },
      include: { contributor: true },
    });
    if (existing) return publicEntry(existing);
  }

  // Movies keep null (poster art). Non-movie ideas get an auto-picked emoji
  // (Claude, or keyword fallback) unless one was explicitly supplied.
  const emoji =
    collection.kind === "movies" ? null : input.emoji || (await pickEmoji(title));

  // For a TMDB-linked movie, look up its IMDb id so cards can link out to IMDb.
  const imdbId = input.imdbId ?? (input.tmdbId ? await getImdbId(input.tmdbId) : null);

  const e = await prisma.entry.create({
    data: {
      collectionId,
      contributorId: userId,
      title,
      description: input.description?.trim() || null,
      emoji,
      location: input.location?.trim() || null,
      cost: input.cost?.trim() || null,
      prep: input.prep?.trim() || null,
      tmdbId: input.tmdbId ?? null,
      imdbId,
      posterPath: input.posterPath ?? null,
      backdropPath: input.backdropPath ?? null,
      releaseYear: input.releaseYear ?? null,
    },
    include: { contributor: true },
  });
  publish({ type: "entries.changed", coupleId, collectionId });
  return publicEntry(e);
}

const BULK_MAX = 500;

export async function createEntriesBulk(
  coupleId: string,
  collectionId: string,
  userId: string,
  items: EntryInput[],
) {
  const collection = await assertCollectionInCouple(collectionId, coupleId);
  const isMovies = collection.kind === "movies";

  let clean = items
    .map((i) => ({ ...i, title: i.title?.trim() ?? "" }))
    .filter((i) => i.title.length > 0)
    .slice(0, BULK_MAX);
  if (clean.length === 0) throw Errors.badRequest("Nothing to import — every row needs a title.");

  // Keep each movie unique: drop rows whose TMDB title is already in the pool,
  // and collapse duplicates within this import, so importing the same list twice
  // never creates copies. Manual/text rows (no tmdbId) are always kept.
  if (isMovies) {
    const present = await prisma.entry.findMany({
      where: { collectionId, deletedAt: null, status: { in: ["available", "selected"] }, tmdbId: { not: null } },
      select: { tmdbId: true },
    });
    const seen = new Set<number>(present.map((e) => e.tmdbId!).filter((v): v is number => typeof v === "number"));
    clean = clean.filter((i) => {
      if (i.tmdbId == null) return true;
      if (seen.has(i.tmdbId)) return false;
      seen.add(i.tmdbId);
      return true;
    });
    if (clean.length === 0) throw Errors.badRequest("Those movies are already in your pool.");
  }

  // Auto-pick emojis in ONE batch call for non-movie ideas without an emoji.
  const needEmoji = isMovies ? [] : clean.filter((i) => !i.emoji).map((i) => i.title);
  const picked = needEmoji.length ? await pickEmojis(needEmoji) : [];
  let pi = 0;
  const emojiFor = (i: (typeof clean)[number]): string | null => {
    if (isMovies) return null;
    if (i.emoji) return i.emoji;
    return picked[pi++] ?? "❤️";
  };

  // For TMDB-linked movies, look up IMDb ids in parallel (bounded) so imported
  // cards link out to IMDb, mirroring the single-add path. Rows the user left as
  // plain text (no tmdbId) skip this and import with no artwork.
  const imdbById = new Map<number, string | null>();
  if (isMovies) {
    const ids = [...new Set(clean.map((i) => i.tmdbId).filter((v): v is number => typeof v === "number"))];
    const CONCURRENCY = 5;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++]!;
          imdbById.set(id, await getImdbId(id));
        }
      }),
    );
  }

  const created = await prisma.$transaction(
    clean.map((i) =>
      prisma.entry.create({
        data: {
          collectionId,
          contributorId: userId,
          title: i.title,
          description: i.description?.trim() || null,
          emoji: emojiFor(i),
          location: i.location?.trim() || null,
          releaseYear: i.releaseYear ?? null,
          tmdbId: isMovies ? i.tmdbId ?? null : null,
          imdbId: isMovies && typeof i.tmdbId === "number" ? imdbById.get(i.tmdbId) ?? null : null,
          posterPath: isMovies ? i.posterPath ?? null : null,
          backdropPath: isMovies ? i.backdropPath ?? null : null,
        },
      }),
    ),
  );
  publish({ type: "entries.changed", coupleId, collectionId });
  return { count: created.length };
}

async function ownedEntry(entryId: string, coupleId: string, userId: string) {
  const e = await prisma.entry.findUnique({ where: { id: entryId }, include: { collection: true } });
  if (!e || e.deletedAt || e.collection.coupleId !== coupleId) throw Errors.notFound("Entry not found");
  if (e.contributorId !== userId) throw Errors.forbidden("You can only change your own ideas");
  return e;
}

/** Find an entry within the couple, regardless of who added it (or whether it's
 *  soft-deleted). Used for deletion/restore, which either partner may do. */
async function coupleEntry(entryId: string, coupleId: string) {
  const e = await prisma.entry.findUnique({ where: { id: entryId }, include: { collection: true } });
  if (!e || e.collection.coupleId !== coupleId) throw Errors.notFound("Entry not found");
  return e;
}

export async function updateEntry(
  coupleId: string,
  entryId: string,
  userId: string,
  input: Partial<EntryInput>,
) {
  const e = await ownedEntry(entryId, coupleId, userId);
  // Historical result revisions keep their own immutable snapshot, so editing
  // here never rewrites past results.
  const updated = await prisma.entry.update({
    where: { id: e.id },
    data: {
      title: input.title?.trim() ?? undefined,
      description: input.description === undefined ? undefined : input.description?.trim() || null,
      emoji: input.emoji === undefined ? undefined : input.emoji,
      location: input.location === undefined ? undefined : input.location?.trim() || null,
      cost: input.cost === undefined ? undefined : input.cost?.trim() || null,
      prep: input.prep === undefined ? undefined : input.prep?.trim() || null,
      tmdbId: input.tmdbId === undefined ? undefined : input.tmdbId,
      posterPath: input.posterPath === undefined ? undefined : input.posterPath,
      backdropPath: input.backdropPath === undefined ? undefined : input.backdropPath,
      releaseYear: input.releaseYear === undefined ? undefined : input.releaseYear,
    },
    include: { contributor: true },
  });
  publish({ type: "entries.changed", coupleId, collectionId: e.collectionId });
  return publicEntry(updated);
}

export async function deleteEntry(coupleId: string, entryId: string) {
  // Either partner can remove any movie/idea from the shared pool (e.g. "we
  // watched it, take it out"). Soft delete preserves historical snapshots.
  const e = await coupleEntry(entryId, coupleId);
  await prisma.entry.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
  publish({ type: "entries.changed", coupleId, collectionId: e.collectionId });
  return { ok: true };
}

export async function restoreEntry(coupleId: string, entryId: string) {
  // Undo a delete — clears the soft-delete flag so the entry returns to the pool.
  const e = await coupleEntry(entryId, coupleId);
  await prisma.entry.update({ where: { id: e.id }, data: { deletedAt: null } });
  publish({ type: "entries.changed", coupleId, collectionId: e.collectionId });
  return { ok: true };
}
