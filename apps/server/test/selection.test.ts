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
    await deleteEntry(couple.id, spun.state.result!.entryId!, a.id);

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
    await deleteEntry(couple.id, spun.state.result!.entryId!, a.id);

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

describe("pick (choose by hand)", () => {
  it("picking records the chosen idea as the week's result", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    const two = await prisma.entry.findFirstOrThrow({ where: { collectionId: dates.id, title: "Two" } });

    const res = await selection.pick(couple.id, dates.id, two.id, { userId: a.id });
    expect(res.created).toBe(true);
    expect(res.state.result?.title).toBe("Two");
    expect(res.state.result?.reason).toBe("pick");
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: two.id } })).status).toBe("selected");
  });

  it("a pick uses up the week: no pick and no fresh draw afterwards", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    const one = await prisma.entry.findFirstOrThrow({ where: { collectionId: dates.id, title: "One" } });
    const three = await prisma.entry.findFirstOrThrow({ where: { collectionId: dates.id, title: "Three" } });

    await selection.pick(couple.id, dates.id, one.id, { userId: a.id });
    await expect(selection.pick(couple.id, dates.id, three.id, { userId: a.id })).rejects.toThrow(/already chosen/);
    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    expect(spun.created).toBe(false);
    expect(spun.state.result?.title).toBe("One");
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(1);
  });

  it("a spin uses up the week: picking afterwards is refused", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    const other = await prisma.entry.findFirstOrThrow({ where: { collectionId: dates.id, status: "available" } });
    await expect(selection.pick(couple.id, dates.id, other.id, { userId: a.id })).rejects.toThrow(/already chosen/);
  });

  it("dates and movies each get their own weekly pick", async () => {
    const { couple, a, dates, movies } = await makeCouple();
    await addEntries(dates.id, a.id, ["Picnic", "Hike"]);
    await addEntries(movies.id, a.id, ["Alien", "Heat"]);
    const picnic = await prisma.entry.findFirstOrThrow({ where: { collectionId: dates.id, title: "Picnic" } });

    await selection.pick(couple.id, dates.id, picnic.id, { userId: a.id });
    const movie = await selection.spin(couple.id, movies.id, { userId: a.id });
    expect(movie.created).toBe(true);
    expect(await prisma.weeklyResult.count()).toBe(2);
  });

  it("rejects an idea that isn't available or belongs to another collection", async () => {
    const { couple, a, dates, movies } = await makeCouple();
    await addEntries(movies.id, a.id, ["Alien"]);
    const alien = await prisma.entry.findFirstOrThrow({ where: { collectionId: movies.id } });
    await expect(selection.pick(couple.id, dates.id, alien.id, { userId: a.id })).rejects.toThrow(/isn't available/);
    expect(await prisma.weeklyResult.count()).toBe(0);
  });

  it("unlocks in the next week window (Sunday morning reset)", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    const one = await prisma.entry.findFirstOrThrow({ where: { collectionId: dates.id, title: "One" } });
    const first = await selection.pick(couple.id, dates.id, one.id, { userId: a.id });
    // The lock ends at the period end, which is a New York Sunday 8:00 AM.
    const reset = new Date(first.state.nextResetAt);
    const ny = new Intl.DateTimeFormat("en-US", { weekday: "long", hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(reset);
    expect(ny).toMatch(/Sunday/);
    expect(ny).toMatch(/8/);
  });
});

describe("week numbering", () => {
  it("starts at Week 1 and only counts up once a week is spun or picked", async () => {
    const { couple, a, dates, movies } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await addEntries(movies.id, a.id, ["Alien"]);

    // Nothing chosen yet: both collections read Week 1, independently.
    expect((await selection.getCurrentState(couple.id, dates.id)).weekIndex).toBe(1);
    expect((await selection.getCurrentState(couple.id, movies.id)).weekIndex).toBe(1);

    await selection.spin(couple.id, dates.id, { userId: a.id });
    expect((await selection.getCurrentState(couple.id, dates.id)).weekIndex).toBe(1);

    // An earlier, already-used week exists (an old pick kept as-is): this week
    // becomes Week 2 for dates. Movies has nothing used yet, so it stays Week 1.
    const period = await prisma.weeklyPeriod.findFirstOrThrow({ where: { collectionId: dates.id } });
    const older = await prisma.weeklyPeriod.create({
      data: {
        collectionId: dates.id,
        cycleIndex: period.cycleIndex,
        weekIndex: 0,
        periodStart: new Date(period.periodStart.getTime() - 7 * 24 * 3600 * 1000),
        periodEnd: period.periodStart,
        scheduledAt: new Date(period.periodStart.getTime() - 7 * 24 * 3600 * 1000),
      },
    });
    const oldResult = await prisma.weeklyResult.create({
      data: { periodId: older.id, collectionId: dates.id, currentRevisionNumber: 1 },
    });
    await prisma.resultRevision.create({
      data: {
        weeklyResultId: oldResult.id, revisionNumber: 1, source: "web", reason: "spin",
        snapTitle: "Old pick", snapContributor: "Alex",
      },
    });
    expect((await selection.getCurrentState(couple.id, dates.id)).weekIndex).toBe(2);
    expect((await selection.getCurrentState(couple.id, movies.id)).weekIndex).toBe(1);

    const history = await selection.getHistory(couple.id, dates.id);
    expect(history.map((h) => [h.weekIndex, h.current.title !== ""])).toEqual([[2, true], [1, true]]);
  });
});
