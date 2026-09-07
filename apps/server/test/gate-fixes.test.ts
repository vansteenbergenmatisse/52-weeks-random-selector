import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import * as selection from "../src/features/selection/service.js";
import * as entries from "../src/features/entries/service.js";
import * as auth from "../src/features/auth/service.js";
import { tick } from "../src/features/scheduling/worker.js";
import { buildIcs } from "../src/features/calendar/ics.js";
import { demoEnabled } from "../src/platform/config/env.js";
import { generateToken, hashToken } from "../src/platform/security/crypto.js";
import { addEntries, makeCouple, makeUser, resetDb } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

/** Regressions for the confirmed findings from the system-wide bug review. */
describe("bug-hunt gate regressions", () => {
  it("auto-select on an empty pool stays retryable (draws once ideas are added)", async () => {
    const { couple, a, dates } = await makeCouple();
    await prisma.collection.update({
      where: { id: dates.id },
      data: { autoSelect: true, cycleStartDate: new Date(Date.now() - 2 * 864e5) },
    });

    // Empty pool at the draw instant → no pick, and (critically) no permanent
    // JobRun claim that would block this week forever.
    await tick(new Date());
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(0);

    // Ideas arrive later; the next tick must still draw for this same week.
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await tick(new Date());
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(1);
    expect(couple.id).toBeTypeOf("string");
  });

  it("markCompleted refuses a pick that was removed from the pool (ghost)", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["Only idea"]);
    const { state } = await selection.spin(couple.id, dates.id, { userId: a.id });
    const entryId = state.result!.entryId!;

    // Remove the picked entry — the result becomes a ghost.
    await entries.deleteEntry(couple.id, entryId);

    await expect(selection.markCompleted(couple.id, dates.id)).rejects.toThrow();
    // The (deleted) entry must NOT have been flipped to completed.
    const e = await prisma.entry.findUniqueOrThrow({ where: { id: entryId } });
    expect(e.status).not.toBe("completed");
  });

  it("restoreEntry refuses to resurrect a movie that's back in the pool", async () => {
    const { couple, a, movies } = await makeCouple();
    const m1 = await prisma.entry.create({
      data: { collectionId: movies.id, contributorId: a.id, title: "Dune", tmdbId: 438631 },
    });
    await entries.deleteEntry(couple.id, m1.id);
    // Re-added while the first copy sits soft-deleted.
    await prisma.entry.create({
      data: { collectionId: movies.id, contributorId: a.id, title: "Dune", tmdbId: 438631 },
    });
    await expect(entries.restoreEntry(couple.id, m1.id)).rejects.toThrow();
  });

  it("updateEntry refuses to change a movie's tmdbId onto one already in the pool", async () => {
    const { couple, a, movies } = await makeCouple();
    const m1 = await prisma.entry.create({
      data: { collectionId: movies.id, contributorId: a.id, title: "A", tmdbId: 111 },
    });
    await prisma.entry.create({
      data: { collectionId: movies.id, contributorId: a.id, title: "B", tmdbId: 222 },
    });
    await expect(entries.updateEntry(couple.id, m1.id, a.id, { tmdbId: 222 })).rejects.toThrow();
  });

  it("acceptInvitation refuses a user already in a different couple (no burned slot)", async () => {
    const { a } = await makeCouple(); // `a` already belongs to a couple
    const owner = await makeUser("owner");
    const { coupleId } = await auth.createCoupleForUser(owner.id, "Owners");
    const inv = await auth.createInvitation(coupleId, owner.id);

    await expect(auth.acceptInvitation(inv.token, a.id)).rejects.toThrow(/already part/i);
    // Slot preserved: no membership created and the single-use token is untouched.
    expect(await prisma.membership.count({ where: { coupleId } })).toBe(1);
    expect((await auth.inspectInvitation(inv.token)).valid).toBe(true);
  });

  it("getUserByToken revokes demo sessions the moment demo mode is off", async () => {
    const demo = await prisma.user.create({
      data: { username: "demo1", displayName: "Demo", isDemo: true, passwordHash: "x" },
    });
    const real = await makeUser("realuser");
    const dToken = generateToken();
    const rToken = generateToken();
    await prisma.session.create({
      data: { userId: demo.id, tokenHash: hashToken(dToken), expiresAt: new Date(Date.now() + 864e5) },
    });
    await prisma.session.create({
      data: { userId: real.id, tokenHash: hashToken(rToken), expiresAt: new Date(Date.now() + 864e5) },
    });

    // A real (non-demo) session always resolves.
    expect((await auth.getUserByToken(rToken))?.username).toBe("realuser");
    // The demo session resolves iff demo mode is on.
    if (demoEnabled) {
      expect((await auth.getUserByToken(dToken))?.username).toBe("demo1");
    } else {
      expect(await auth.getUserByToken(dToken)).toBeNull();
    }
  });

  it("buildIcs folds long content lines to <=75 octets (RFC 5545)", () => {
    const longDesc = "A wonderfully long description ".repeat(8).trim();
    const ics = buildIcs({
      uid: "u@our52",
      start: new Date("2026-01-01T20:00:00Z"),
      end: new Date("2026-01-01T22:00:00Z"),
      title: "Movie night",
      description: longDesc,
      location: null,
      organizerEmail: "a@b.com",
      attendeeEmails: ["c@d.com"],
    });
    const lines = ics.split("\r\n");
    for (const l of lines) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    // The long DESCRIPTION must have been folded across a continuation line
    // (RFC 5545 continuations begin with a single space).
    expect(lines.some((l) => l.startsWith(" "))).toBe(true);
  });
});
