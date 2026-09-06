import { describe, it, expect, beforeEach } from "vitest";
import {
  createEntry,
  createEntriesBulk,
  deleteEntry,
  restoreEntry,
  listEntries,
  getProgress,
} from "../src/features/entries/service.js";
import * as selection from "../src/features/selection/service.js";
import { prisma } from "../src/platform/db/prisma.js";
import { resetDb, makeCouple } from "./helpers.js";

describe("entry deletion (shared pool)", () => {
  beforeEach(resetDb);

  it("lets either partner delete a movie the other added", async () => {
    const { couple, a, b, movies } = await makeCouple();
    const e = await createEntry(couple.id, movies.id, a.id, { title: "Inception" });

    // b (the other partner) removes a's movie
    await deleteEntry(couple.id, e.id);

    const remaining = await listEntries(couple.id, movies.id);
    expect(remaining.find((x) => x.id === e.id)).toBeUndefined();
    void b;
  });

  it("keeps couples isolated — a stranger's couple can't delete the entry", async () => {
    const one = await makeCouple("one");
    const two = await makeCouple("two");
    const e = await createEntry(one.couple.id, one.movies.id, one.a.id, { title: "Parasite" });

    await expect(deleteEntry(two.couple.id, e.id)).rejects.toThrow(/not found/i);

    const stillThere = await prisma.entry.findUnique({ where: { id: e.id } });
    expect(stillThere?.deletedAt).toBeNull();
  });

  it("restore undoes a delete", async () => {
    const { couple, a, movies } = await makeCouple();
    const e = await createEntry(couple.id, movies.id, a.id, { title: "Whiplash" });

    await deleteEntry(couple.id, e.id);
    await restoreEntry(couple.id, e.id);

    const back = await listEntries(couple.id, movies.id);
    expect(back.find((x) => x.id === e.id)?.title).toBe("Whiplash");
  });
});

describe("movies stay unique in the pool (no duplicates)", () => {
  beforeEach(resetDb);

  it("adding the same movie twice returns the existing entry, not a copy", async () => {
    const { couple, a, movies } = await makeCouple();
    const first = await createEntry(couple.id, movies.id, a.id, { title: "Parasite", tmdbId: 496243 });
    const second = await createEntry(couple.id, movies.id, a.id, { title: "Parasite", tmdbId: 496243 });

    expect(second.id).toBe(first.id);
    const rows = await prisma.entry.findMany({ where: { collectionId: movies.id, deletedAt: null } });
    expect(rows.length).toBe(1);
  });

  it("bulk import skips movies already in the pool and collapses in-batch dupes", async () => {
    const { couple, a, movies } = await makeCouple();
    await createEntry(couple.id, movies.id, a.id, { title: "Parasite", tmdbId: 496243 });

    const res = await createEntriesBulk(couple.id, movies.id, a.id, [
      { title: "Parasite", tmdbId: 496243 }, // already in pool → skip
      { title: "Inception", tmdbId: 27205 }, // new
      { title: "Inception (dup)", tmdbId: 27205 }, // dupe within batch → skip
      { title: "Some manual pick" }, // no tmdbId → always kept
    ]);

    expect(res.count).toBe(2);
    const titles = (await listEntries(couple.id, movies.id)).map((e) => e.title).sort();
    expect(titles).toEqual(["Inception", "Parasite", "Some manual pick"]);
  });
});

describe("completing a movie retires every copy of it", () => {
  beforeEach(resetDb);

  it("marks all same-movie entries completed so none linger in the pool", async () => {
    const { couple, a, movies } = await makeCouple();
    // Two copies of the same movie (insert directly to simulate a pre-existing duplicate).
    await prisma.entry.create({ data: { collectionId: movies.id, contributorId: a.id, title: "Parasite", tmdbId: 496243 } });
    await prisma.entry.create({ data: { collectionId: movies.id, contributorId: a.id, title: "Parasite", tmdbId: 496243 } });

    await selection.spin(couple.id, movies.id, { userId: a.id });
    await selection.markCompleted(couple.id, movies.id);

    const available = await prisma.entry.count({ where: { collectionId: movies.id, status: "available" } });
    const completed = await prisma.entry.count({ where: { collectionId: movies.id, status: "completed" } });
    expect(available).toBe(0);
    expect(completed).toBe(2);
  });
});

describe("getProgress counts only what's in the pool", () => {
  beforeEach(resetDb);

  it("excludes selected/completed entries so the count matches the visible cards", async () => {
    const { couple, a, movies } = await makeCouple();
    const kept = await createEntry(couple.id, movies.id, a.id, { title: "Available one" });
    const watched = await createEntry(couple.id, movies.id, a.id, { title: "Already watched" });
    // Mark one as completed (as the roulette would) — it should drop out of the count.
    await prisma.entry.update({ where: { id: watched.id }, data: { status: "completed" } });

    const progress = await getProgress(couple.id, movies.id);
    const row = progress.contributors.find((c) => c.userId === a.id)!;
    expect(row.added).toBe(1); // only the available one, not the watched one
    void kept;
  });
});
