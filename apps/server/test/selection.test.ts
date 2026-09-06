import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import * as selection from "../src/features/selection/service.js";
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

  it("reroll returns the rejected entry to the pool but excludes it from the replacement", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);

    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    const rejected = spun.state.result!.title;

    const rr = await selection.reroll(couple.id, dates.id, { userId: a.id, expectedRevision: 1 });
    expect(rr.replaced).toBe(true);
    expect(rr.state.result!.title).not.toBe(rejected); // different pick
    expect(rr.state.revision).toBe(2);

    // Rejected entry is back to available.
    const rejectedEntry = await prisma.entry.findFirst({ where: { collectionId: dates.id, title: rejected } });
    expect(rejectedEntry?.status).toBe("available");
  });

  it("reroll with no alternative keeps the current result", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["OnlyOne"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });

    const rr = await selection.reroll(couple.id, dates.id, { userId: a.id, expectedRevision: 1 });
    expect(rr.replaced).toBe(false);
    expect(rr.reason).toBe("no_alternative");
    expect(rr.state.result!.title).toBe("OnlyOne");
    expect(rr.state.revision).toBe(1);
  });

  it("concurrent rerolls against the same revision cause ONE replacement", async () => {
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three", "Four", "Five", "Six"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });

    const [x, y] = await Promise.all([
      selection.reroll(couple.id, dates.id, { userId: a.id, expectedRevision: 1 }),
      selection.reroll(couple.id, dates.id, { userId: b.id, expectedRevision: 1 }),
    ]);
    const replacements = [x.replaced, y.replaced].filter(Boolean).length;
    expect(replacements).toBe(1);
    const result = await prisma.weeklyResult.findFirst({ where: { collectionId: dates.id } });
    expect(result?.currentRevisionNumber).toBe(2); // only one bump
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
});
