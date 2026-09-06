import { prisma } from "../src/platform/db/prisma.js";
import { hashPassword } from "../src/platform/security/crypto.js";
import { createDefaultCollections } from "../src/features/collections/service.js";
import { firstScheduledInstant } from "../src/shared/time.js";

/** Wipe all tables between tests. Deletes children before parents so foreign
 *  keys are satisfied (SQLite has no TRUNCATE ... CASCADE). DB-agnostic. */
export async function resetDb() {
  await prisma.resultRevision.deleteMany();
  await prisma.weeklyResult.deleteMany();
  await prisma.weeklyPeriod.deleteMany();
  await prisma.entry.deleteMany();
  await prisma.outboundMessage.deleteMany();
  await prisma.processedInboundEvent.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.whatsAppConfig.deleteMany();
  await prisma.whatsAppSession.deleteMany();
  await prisma.calendarConfig.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.session.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.user.deleteMany();
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
