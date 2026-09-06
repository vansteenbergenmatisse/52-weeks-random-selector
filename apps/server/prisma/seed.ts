import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DateTime } from "luxon";

const prisma = new PrismaClient();

const TZ = process.env.DEFAULT_TIMEZONE ?? "America/New_York";

function firstSunday8pm(): Date {
  let dt = DateTime.now().setZone(TZ).set({ hour: 20, minute: 0, second: 0, millisecond: 0 });
  while (dt.weekday !== 7 || dt.toMillis() <= Date.now()) {
    dt = dt.plus({ days: 1 }).set({ hour: 20, minute: 0, second: 0, millisecond: 0 });
  }
  return dt.toUTC().toJSDate();
}

const DATE_IDEAS: Array<{ title: string; emoji: string; description?: string }> = [
  { title: "Sunset picnic", emoji: "🌅", description: "Bring a blanket and your favorite snacks." },
  { title: "Cook a new recipe together", emoji: "🍝", description: "Pick a cuisine neither of us has tried." },
  { title: "Farmers market morning", emoji: "🧺" },
  { title: "Stargazing drive", emoji: "🌌", description: "Head out of town where it's dark." },
  { title: "Board game café", emoji: "🎲" },
  { title: "Bike ride + coffee", emoji: "🚲" },
  { title: "Museum wander", emoji: "🖼️" },
  { title: "Home spa night", emoji: "🧖", description: "Face masks, candles, no phones." },
  { title: "Bookstore date", emoji: "📚", description: "Each pick a book for the other." },
  { title: "Sunrise hike", emoji: "⛰️" },
  { title: "Karaoke night", emoji: "🎤" },
  { title: "Pottery class", emoji: "🏺" },
];

const MOVIE_IDEAS: Array<{ title: string; year: number; description?: string }> = [
  { title: "Everything Everywhere All at Once", year: 2022 },
  { title: "The Grand Budapest Hotel", year: 2014 },
  { title: "Spirited Away", year: 2001 },
  { title: "La La Land", year: 2016 },
  { title: "Parasite", year: 2019 },
  { title: "Amélie", year: 2001 },
  { title: "Knives Out", year: 2019 },
  { title: "Past Lives", year: 2023 },
  { title: "Paddington 2", year: 2017 },
  { title: "Arrival", year: 2016 },
  { title: "The Princess Bride", year: 1987 },
  { title: "In the Mood for Love", year: 2000 },
];

async function ensureUser(username: string, displayName: string, avatarUrl: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      username,
      displayName,
      avatarUrl,
      isDemo: true,
      passwordHash: await bcrypt.hash("12345", 12),
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

  // Seed entries only if the collection is empty (keeps seed idempotent).
  const datesCount = await prisma.entry.count({ where: { collectionId: dates.id } });
  if (datesCount === 0) {
    for (let i = 0; i < DATE_IDEAS.length; i++) {
      const idea = DATE_IDEAS[i]!;
      await prisma.entry.create({
        data: {
          collectionId: dates.id,
          contributorId: i % 2 === 0 ? teresa.id : matisse.id,
          title: idea.title,
          emoji: idea.emoji,
          description: idea.description ?? null,
        },
      });
    }
  }

  const moviesCount = await prisma.entry.count({ where: { collectionId: movies.id } });
  if (moviesCount === 0) {
    for (let i = 0; i < MOVIE_IDEAS.length; i++) {
      const idea = MOVIE_IDEAS[i]!;
      await prisma.entry.create({
        data: {
          collectionId: movies.id,
          contributorId: i % 2 === 0 ? matisse.id : teresa.id,
          title: idea.title,
          releaseYear: idea.year,
          description: idea.description ?? null,
        },
      });
    }
  }

  console.log(`Done. Demo couple "${coupleId}" ready.`);
  console.log("Login with teresa / 12345 or matisse / 12345 (demo mode only).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
