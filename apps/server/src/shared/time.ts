import { DateTime } from "luxon";

export const WEEKS_PER_CYCLE = 52;

export interface ScheduleSpec {
  weekday: number; // 0=Sunday .. 6=Saturday
  time: string; // "HH:mm" local
  timezone: string; // IANA zone
}

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":");
  return { hour: Number(h ?? 0), minute: Number(m ?? 0) };
}

/** Luxon weekday: 1=Mon..7=Sun. Convert from JS 0=Sun..6=Sat. */
function toLuxonWeekday(jsWeekday: number): number {
  return jsWeekday === 0 ? 7 : jsWeekday;
}

/**
 * The first scheduled moment (week 1) on/after `from`, as a UTC instant.
 * Wall-clock time is anchored in the collection's timezone so DST is honored.
 */
export function firstScheduledInstant(spec: ScheduleSpec, from: Date = new Date()): Date {
  const { hour, minute } = parseTime(spec.time);
  const target = toLuxonWeekday(spec.weekday);
  let dt = DateTime.fromJSDate(from, { zone: spec.timezone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
  // Advance to the target weekday (today counts only if still in the future).
  while (dt.weekday !== target || dt.toMillis() <= from.getTime()) {
    dt = dt.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
  }
  return dt.toUTC().toJSDate();
}

export interface WeekBounds {
  start: Date; // scheduled draw instant (UTC)
  end: Date; // next week's start (UTC)
  scheduledAt: Date; // == start
}

/**
 * Bounds of a given 1-based week within the cycle. Uses local-wall-time
 * arithmetic (plus weeks) so 8:00 PM stays 8:00 PM across DST transitions.
 */
export function weekBounds(cycleStart: Date, timezone: string, weekIndex: number): WeekBounds {
  const base = DateTime.fromJSDate(cycleStart, { zone: timezone });
  const start = base.plus({ weeks: weekIndex - 1 });
  const end = base.plus({ weeks: weekIndex });
  return {
    start: start.toUTC().toJSDate(),
    end: end.toUTC().toJSDate(),
    scheduledAt: start.toUTC().toJSDate(),
  };
}

/**
 * The 1-based week index that `now` falls into, clamped to [1, WEEKS_PER_CYCLE].
 * Returns 0 if the cycle has not started yet.
 */
export function currentWeekIndex(cycleStart: Date, timezone: string, now: Date = new Date()): number {
  if (now.getTime() < cycleStart.getTime()) return 0;
  // Approximate, then correct for DST drift by checking neighbouring bounds.
  const approx = Math.floor(
    DateTime.fromJSDate(now, { zone: timezone }).diff(
      DateTime.fromJSDate(cycleStart, { zone: timezone }),
      "weeks",
    ).weeks,
  ) + 1;
  let idx = Math.max(1, approx);
  // Correct upward/downward using exact wall-time bounds.
  while (idx < WEEKS_PER_CYCLE && weekBounds(cycleStart, timezone, idx).end.getTime() <= now.getTime()) {
    idx += 1;
  }
  while (idx > 1 && weekBounds(cycleStart, timezone, idx).start.getTime() > now.getTime()) {
    idx -= 1;
  }
  return Math.min(idx, WEEKS_PER_CYCLE);
}

/** Whether the cycle (52 weeks) has fully elapsed. */
export function cycleIsComplete(cycleStart: Date, timezone: string, now: Date = new Date()): boolean {
  return now.getTime() >= weekBounds(cycleStart, timezone, WEEKS_PER_CYCLE).end.getTime();
}

export function describeSchedule(spec: ScheduleSpec): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `${days[spec.weekday]} at ${spec.time} (${spec.timezone})`;
}
