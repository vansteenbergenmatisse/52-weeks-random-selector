import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DateTime } from "luxon";
import { currentWeekIndex, weekBounds } from "../src/shared/time.js";

const prisma = new PrismaClient();

const TZ = process.env.DEFAULT_TIMEZONE ?? "America/New_York";

// Demo (Teresa/Matisse) accounts sign in via the passcode-gated space picker,
// not a password — so their seeded password is never sent by the client and
// never logged. Use DEMO_PASSWORD if provided, else a strong random one that
// is only set the first time each account is created (the seed is idempotent).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || randomBytes(24).toString("base64url");

// The week rolls over — and spin/pick unlock again — on Sunday at 8:00 AM New York time.
const WEEK_RESET_TIME = "08:00";

function firstSunday8am(): Date {
  let dt = DateTime.now().setZone(TZ).set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  while (dt.weekday !== 7 || dt.toMillis() <= Date.now()) {
    dt = dt.plus({ days: 1 }).set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  }
  return dt.toUTC().toJSDate();
}

/**
 * One-time move of existing spaces from the old Sunday 8:00 PM week boundary to
 * Sunday 8:00 AM. Only the time of day on the existing anchor changes, so week
 * numbers, history and picks are untouched. Guarded by a JobRun key so it runs
 * once and never overrides a time the couple later sets in Settings.
 */
async function moveWeekResetToSundayMorning() {
  const jobKey = "migrate:week-reset-sunday-8am";
  if (await prisma.jobRun.findUnique({ where: { jobKey } })) return;
  const collections = await prisma.collection.findMany();
  for (const c of collections) {
    if (!c.cycleStartDate || c.scheduleTime !== "20:00") continue;
    const anchor = DateTime.fromJSDate(c.cycleStartDate, { zone: c.scheduleTimezone }).set({
      hour: 8, minute: 0, second: 0, millisecond: 0,
    });
    await prisma.collection.update({
      where: { id: c.id },
      data: { scheduleTime: WEEK_RESET_TIME, cycleStartDate: anchor.toUTC().toJSDate() },
    });
    // Keep stored period bounds in step with the new anchor (read-only metadata).
    const periods = await prisma.weeklyPeriod.findMany({ where: { collectionId: c.id } });
    for (const p of periods) {
      const start = DateTime.fromJSDate(p.periodStart, { zone: c.scheduleTimezone }).set({ hour: 8, minute: 0 });
      const end = DateTime.fromJSDate(p.periodEnd, { zone: c.scheduleTimezone }).set({ hour: 8, minute: 0 });
      await prisma.weeklyPeriod.update({
        where: { id: p.id },
        data: { periodStart: start.toUTC().toJSDate(), periodEnd: end.toUTC().toJSDate(), scheduledAt: start.toUTC().toJSDate() },
      });
    }
  }
  await prisma.jobRun.create({ data: { jobKey, type: "migration", status: "done" } });
}

/**
 * One-time: restart the Dates "Week N/52" counter at 1 (requested 2026-10-18).
 * Nothing is deleted — earlier picks stay in History as "Past" weeks. Guarded by
 * a JobRun key so it runs once.
 */
async function restartDatesWeekCount() {
  const jobKey = "migrate:dates-week-count-restart-2026-10-18";
  if (await prisma.jobRun.findUnique({ where: { jobKey } })) return;
  const dates = await prisma.collection.findMany({ where: { kind: "dates" } });
  for (const c of dates) {
    if (!c.cycleStartDate) continue;
    const idx = Math.max(1, currentWeekIndex(c.cycleStartDate, c.scheduleTimezone));
    const start = weekBounds(c.cycleStartDate, c.scheduleTimezone, idx).start;
    await prisma.collection.update({ where: { id: c.id }, data: { weekCountFrom: start } });
  }
  await prisma.jobRun.create({ data: { jobKey, type: "migration", status: "done" } });
}

// NOTE: There is intentionally NO example date/movie seed data. A fresh space
// starts empty and the couple adds only their own ideas — the app must never
// inject "random" demo entries. (Removed for good; see PLAN.md §0.)

async function ensureUser(username: string, displayName: string, avatarUrl: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      username,
      displayName,
      avatarUrl,
      isDemo: true,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
    },
  });
}

async function main() {
  console.log("Seeding demo couple (idempotent)…");

  const teresa = await ensureUser("teresa", "Teresa", "🌸");
  const matisse = await ensureUser("matisse", "Matisse", "🎨");

  // Find or create the demo couple via Teresa's membership.
  let membership = await prisma.membership.findFirst({ where: { userId: teresa.id }, include: { couple: true } });
  let coupleId: string;
  if (membership) {
    coupleId = membership.coupleId;
  } else {
    const couple = await prisma.couple.create({ data: { name: "Teresa & Matisse" } });
    coupleId = couple.id;
    await prisma.membership.create({ data: { coupleId, userId: teresa.id, role: "owner" } });
  }
  // Ensure Matisse is the second member.
  const matisseMembership = await prisma.membership.findUnique({
    where: { coupleId_userId: { coupleId, userId: matisse.id } },
  });
  if (!matisseMembership) {
    const count = await prisma.membership.count({ where: { coupleId } });
    if (count < 2) await prisma.membership.create({ data: { coupleId, userId: matisse.id, role: "member" } });
  }

  // Ensure Dates & Movies collections.
  const collections = await prisma.collection.findMany({ where: { coupleId } });
  const cycleStart = firstSunday8am();

  let dates = collections.find((c) => c.kind === "dates");
  if (!dates) {
    dates = await prisma.collection.create({
      data: {
        coupleId,
        name: "Dates",
        kind: "dates",
        emoji: "🌅",
        colorKey: "red",
        scheduleTimezone: TZ,
        scheduleWeekday: 0,
        scheduleTime: WEEK_RESET_TIME,
        cycleStartDate: cycleStart,
      },
    });
  }
  let movies = collections.find((c) => c.kind === "movies");
  if (!movies) {
    movies = await prisma.collection.create({
      data: {
        coupleId,
        name: "Movies",
        kind: "movies",
        emoji: "🎬",
        colorKey: "blue",
        scheduleTimezone: TZ,
        scheduleWeekday: 0,
        scheduleTime: WEEK_RESET_TIME,
        cycleStartDate: cycleStart,
      },
    });
  }

  await moveWeekResetToSundayMorning();
  await restartDatesWeekCount();

  // No example ideas are ever seeded. Both collections start empty; the couple
  // fills them with their own dates/movies. `dates` and `movies` exist only to
  // guarantee the two default collections are present.
  void dates;
  void movies;

  console.log(`Done. Shared space "${coupleId}" ready.`);
  console.log("Enter via the one-tap Teresa/Matisse picker (gated by SPACE_PASSCODE when set).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
