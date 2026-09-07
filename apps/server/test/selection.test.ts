import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import * as selection from "../src/features/selection/service.js";
import { deleteEntry } from "../src/features/entries/service.js";
import { addEntries, makeCouple, resetDb } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("selection", () => {
  it("spins to a real winner and persists exactly one result", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);

    const res = await selection.spin(couple.id, dates.id, { userId: a.id, source: "web" });
    expect(res.created).toBe(true);
    expect(res.state.result?.title).toBeTypeOf("string");

    const results = await prisma.weeklyResult.count({ where: { collectionId: dates.id } });
    expect(results).toBe(1);
  });

  it("reveal is idempotent — reloading never draws again", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);

    const first = await selection.spin(couple.id, dates.id, { userId: a.id });
    const again = await selection.spin(couple.id, dates.id, { userId: a.id });
    expect(again.created).toBe(false);
    expect(again.state.result?.title).toBe(first.state.result?.title);
    expect(await prisma.weeklyResult.count()).toBe(1);
  });

  it("concurrent spins from both people produce ONE result", async () => {
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three", "Four", "Five"]);

    const [r1, r2] = await Promise.all([
      selection.spin(couple.id, dates.id, { userId: a.id }),
      selection.spin(couple.id, dates.id, { userId: b.id }),
    ]);
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(1);
    // Both callers observe the same winner.
    expect(r1.state.result?.title).toBe(r2.state.result?.title);
    // Exactly one of them created it.
    expect([r1.created, r2.created].filter(Boolean).length).toBe(1);
  });

  it("selected entries are excluded from future draws", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    const res = await selection.spin(couple.id, dates.id, { userId: a.id });
    const winnerTitle = res.state.result!.title;
    const winner = await prisma.entry.findFirst({ where: { collectionId: dates.id, title: winnerTitle } });
    expect(winner?.status).toBe("selected");
  });

  it("reroll is disabled — the week's pick is locked once decided", async () => {
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);

    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    const picked = spun.state.result!.title;

    // Either partner trying to reroll gets a no-op "locked" — the pick can't change.
    const rr = await selection.reroll(couple.id, dates.id, { userId: b.id, expectedRevision: 1 });
    expect(rr.replaced).toBe(false);
    expect(rr.reason).toBe("locked");
    expect(rr.state.result!.title).toBe(picked); // unchanged
    expect(rr.state.revision).toBe(1);

    // The picked entry stays selected; nothing is returned to the pool, and only
    // the original revision exists.
    const pickedEntry = await prisma.entry.findFirst({ where: { collectionId: dates.id, title: picked } });
    expect(pickedEntry?.status).toBe("selected");
    expect(await prisma.resultRevision.count()).toBe(1);
  });

  it("completion marks the entry completed and keeps it excluded", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    const state = await selection.markCompleted(couple.id, dates.id);
    expect(state.completed).toBe(true);
    const completed = await prisma.entry.count({ where: { collectionId: dates.id, status: "completed" } });
    expect(completed).toBe(1);
  });

  it("removing the current pick stops it replaying as a ghost when the pool is empty", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["OnlyOne"]);
    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    expect(spun.state.hasResult).toBe(true);

    // Remove the only idea (which is this week's pick). Pool is now empty.
    await deleteEntry(couple.id, spun.state.result!.entryId!);

    const state = await selection.getCurrentState(couple.id, dates.id);
    expect(state.hasResult).toBe(false); // no ghost pick
    expect(state.result).toBeNull();
    expect(state.availableCount).toBe(0);
    expect(state.action).toBe("spin");
  });

  it("spinning after the old pick was removed draws fresh from the remaining pool", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    const removed = spun.state.result!.title;
    await deleteEntry(couple.id, spun.state.result!.entryId!);

    // The stale result is discarded and a new winner is drawn from what's left.
    const again = await selection.spin(couple.id, dates.id, { userId: a.id });
    expect(again.created).toBe(true);
    expect(again.state.result!.title).not.toBe(removed);
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(1);
  });

  it("random selection is roughly uniform (equal probability)", { timeout: 60000 }, async () => {
    // Fresh couple each iteration, single week, count winners across many trials.
    const counts: Record<string, number> = {};
    const N = 80;
    for (let i = 0; i < N; i++) {
      const { couple, a, dates } = await makeCouple(`u${i}`);
      await addEntries(dates.id, a.id, ["A", "B", "C", "D"]);
      const res = await selection.spin(couple.id, dates.id, { userId: a.id });
      const t = res.state.result!.title;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    // Each of 4 options should appear; none should dominate absurdly.
    expect(Object.keys(counts).length).toBe(4);
    for (const k of ["A", "B", "C", "D"]) {
      expect(counts[k] ?? 0).toBeGreaterThan(N / 4 / 3); // > ~10
    }
  });

  it("dates and movies have independent results", async () => {
    const { couple, a, dates, movies } = await makeCouple();
    await addEntries(dates.id, a.id, ["D1", "D2"]);
    await addEntries(movies.id, a.id, ["M1", "M2"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    const moviesState = await selection.getCurrentState(couple.id, movies.id);
    expect(moviesState.hasResult).toBe(false); // spinning dates didn't affect movies
  });

  it("empty pool cannot spin", async () => {
    const { couple, dates } = await makeCouple();
    await expect(selection.spin(couple.id, dates.id, {})).rejects.toThrow();
  });

  it("skip returns the skipped pick to the pool and lands on a different one", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    const firstPick = spun.state.result!.title;

    const res = await selection.skip(couple.id, dates.id, { userId: a.id });
    expect(res.skipped).toBe(true);
    expect(res.state.result!.title).not.toBe(firstPick); // landed on the other one

    // The skipped idea is back in the pool (status available), not gone.
    const skippedBack = await prisma.entry.findFirst({ where: { collectionId: dates.id, title: firstPick } });
    expect(skippedBack?.status).toBe("available");
  });

  it("resetToZero wipes ideas, the current pick, history, and the counts — only that collection", async () => {
    const { couple, a, dates, movies } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await addEntries(movies.id, a.id, ["Film A", "Film B"]); // a sibling collection to prove isolation
    await selection.spin(couple.id, dates.id, { userId: a.id }); // pick + period + result
    await selection.markCompleted(couple.id, dates.id); // completed entry + result history

    const state = await selection.resetToZero(couple.id, dates.id);
    expect(state.result).toBeNull();
    expect(state.availableCount).toBe(0);
    expect(await prisma.entry.count({ where: { collectionId: dates.id } })).toBe(0); // hard-wiped
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(0); // no picks, history gone
    expect(state.cycleIndex).toBe(0); // cycle restarted from zero

    // The other collection is untouched.
    expect(await prisma.entry.count({ where: { collectionId: movies.id } })).toBe(2);
  });
});
