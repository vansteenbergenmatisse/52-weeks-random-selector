import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DateTime } from "luxon";

const prisma = new PrismaClient();

const TZ = process.env.DEFAULT_TIMEZONE ?? "America/New_York";

// Demo (Teresa/Matisse) accounts sign in via the passcode-gated space picker,
// not a password — so their seeded password is never sent by the client and
// never logged. Use DEMO_PASSWORD if provided, else a strong random one that
// is only set the first time each account is created (the seed is idempotent).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || randomBytes(24).toString("base64url");

function firstSunday8pm(): Date {
  let dt = DateTime.now().setZone(TZ).set({ hour: 20, minute: 0, second: 0, millisecond: 0 });
  while (dt.weekday !== 7 || dt.toMillis() <= Date.now()) {
    dt = dt.plus({ days: 1 }).set({ hour: 20, minute: 0, second: 0, millisecond: 0 });
  }
  return dt.toUTC().toJSDate();
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
  const cycleStart = firstSunday8pm();

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
        scheduleTime: "20:00",
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
        scheduleTime: "20:00",
        cycleStartDate: cycleStart,
      },
    });
  }

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
