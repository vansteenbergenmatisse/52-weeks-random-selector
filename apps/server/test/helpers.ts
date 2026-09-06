import { prisma } from "../src/platform/db/prisma.js";
import { hashPassword } from "../src/platform/security/crypto.js";
import { createDefaultCollections } from "../src/features/collections/service.js";
import { firstScheduledInstant } from "../src/shared/time.js";

/** Wipe all tables between tests (order respects FKs via cascade). */
export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ProcessedInboundEvent","OutboundMessage","ResultRevision","WeeklyResult","WeeklyPeriod",
      "Entry","Collection","WhatsAppConfig","WhatsAppSession","Invitation","Membership",
      "Session","JobRun","Couple","User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function makeUser(username: string, displayName = username) {
  return prisma.user.create({
    data: { username, displayName, passwordHash: await hashPassword("12345") },
  });
}

/** Create a couple with two members and default Dates+Movies collections. */
export async function makeCouple(name = "Test couple") {
  const a = await makeUser(`a_${name}_${Math.round(performance.now())}`, "Alex");
  const b = await makeUser(`b_${name}_${Math.round(performance.now())}`, "Sam");
  const couple = await prisma.couple.create({ data: { name } });
  await prisma.membership.create({ data: { coupleId: couple.id, userId: a.id, role: "owner" } });
  await prisma.membership.create({ data: { coupleId: couple.id, userId: b.id, role: "member" } });
  await createDefaultCollections(prisma, couple.id);
  const collections = await prisma.collection.findMany({ where: { coupleId: couple.id } });
  return { couple, a, b, dates: collections.find((c) => c.kind === "dates")!, movies: collections.find((c) => c.kind === "movies")! };
}

export async function addEntries(collectionId: string, contributorId: string, titles: string[]) {
  for (const title of titles) {
    await prisma.entry.create({ data: { collectionId, contributorId, title, emoji: "🎲" } });
  }
}

export { firstScheduledInstant };
