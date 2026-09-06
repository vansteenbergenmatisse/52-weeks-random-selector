import { describe, it, expect, beforeEach } from "vitest";
import {
  createEntry,
  deleteEntry,
  restoreEntry,
  listEntries,
  getProgress,
} from "../src/features/entries/service.js";
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
