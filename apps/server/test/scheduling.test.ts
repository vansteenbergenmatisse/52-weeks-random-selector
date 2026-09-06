import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  currentWeekIndex,
  firstScheduledInstant,
  weekBounds,
  cycleIsComplete,
  WEEKS_PER_CYCLE,
} from "../src/shared/time.js";

const NY = "America/New_York";
const spec = { weekday: 0, time: "20:00", timezone: NY }; // Sunday 8pm

describe("weekly scheduling (DST-aware, IANA)", () => {
  it("first scheduled instant is a Sunday 8pm New York", async () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const inst = firstScheduledInstant(spec, from);
    const local = DateTime.fromJSDate(inst, { zone: NY });
    expect(local.weekday).toBe(7); // Sunday in luxon
    expect(local.hour).toBe(20);
    expect(local.minute).toBe(0);
  });

  it("keeps 8pm local across the spring-forward DST boundary", async () => {
    // US DST 2026 begins Sun Mar 8. Anchor before it, walk weeks across it.
    const cycleStart = firstScheduledInstant(spec, new Date("2026-02-15T12:00:00Z"));
    for (let w = 1; w <= 6; w++) {
      const { start } = weekBounds(cycleStart, NY, w);
      const local = DateTime.fromJSDate(start, { zone: NY });
      expect(local.hour).toBe(20); // still 8pm despite the offset change
      expect(local.weekday).toBe(7);
    }
    // The UTC offset actually changed within that span (proving DST handling).
    const before = DateTime.fromJSDate(weekBounds(cycleStart, NY, 1).start, { zone: NY }).offset;
    const after = DateTime.fromJSDate(weekBounds(cycleStart, NY, 6).start, { zone: NY }).offset;
    expect(before).not.toBe(after);
  });

  it("keeps 8pm local across the fall-back DST boundary", async () => {
    // US DST 2026 ends Sun Nov 1.
    const cycleStart = firstScheduledInstant(spec, new Date("2026-10-11T12:00:00Z"));
    for (let w = 1; w <= 5; w++) {
      const { start } = weekBounds(cycleStart, NY, w);
      const local = DateTime.fromJSDate(start, { zone: NY });
      expect(local.hour).toBe(20);
    }
  });

  it("currentWeekIndex advances weekly and clamps at 52", async () => {
    const cycleStart = firstScheduledInstant(spec, new Date("2026-01-01T00:00:00Z"));
    const w1 = weekBounds(cycleStart, NY, 1).start;
    expect(currentWeekIndex(cycleStart, NY, new Date(w1.getTime() + 1000))).toBe(1);
    const w3 = weekBounds(cycleStart, NY, 3).start;
    expect(currentWeekIndex(cycleStart, NY, new Date(w3.getTime() + 1000))).toBe(3);
    const wayAfter = new Date(cycleStart.getTime() + 400 * 864e5);
    expect(currentWeekIndex(cycleStart, NY, wayAfter)).toBe(WEEKS_PER_CYCLE);
  });

  it("cycle completes after 52 weeks", async () => {
    const cycleStart = firstScheduledInstant(spec, new Date("2026-01-01T00:00:00Z"));
    const end = weekBounds(cycleStart, NY, WEEKS_PER_CYCLE).end;
    expect(cycleIsComplete(cycleStart, NY, new Date(end.getTime() + 1000))).toBe(true);
    expect(cycleIsComplete(cycleStart, NY, new Date(cycleStart.getTime() + 1000))).toBe(false);
  });
});
