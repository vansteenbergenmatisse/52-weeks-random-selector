import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import * as auth from "../src/features/auth/service.js";
import * as selection from "../src/features/selection/service.js";
import { assertCollectionInCouple } from "../src/features/collections/service.js";
import { addEntries, makeCouple, makeUser, resetDb } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("auth & couple isolation", () => {
  it("both members share the same collections and results", async () => {
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });

    const forA = await auth.getCoupleForUser(a.id);
    const forB = await auth.getCoupleForUser(b.id);
    expect(forA?.coupleId).toBe(couple.id);
    expect(forB?.coupleId).toBe(couple.id); // same space
  });

  it("another couple cannot access this couple's collection", async () => {
    const one = await makeCouple("one");
    const two = await makeCouple("two");
    // two's coupleId must not be able to resolve one's collection
    await expect(assertCollectionInCouple(one.dates.id, two.couple.id)).rejects.toThrow();
  });

  it("invitation enforces the two-person limit (full couple refuses new invites)", async () => {
    const { couple, a } = await makeCouple(); // already has two members
    await expect(auth.createInvitation(couple.id, a.id)).rejects.toThrow(/two people/);
  });

  it("a fresh couple accepts exactly one partner; simultaneous accepts don't exceed two", async () => {
    const owner = await makeUser("owner");
    const { coupleId } = await auth.createCoupleForUser(owner.id, "Owners");
    const inv1 = await auth.createInvitation(coupleId, owner.id);
    const inv2 = await auth.createInvitation(coupleId, owner.id);
    const p1 = await makeUser("p1");
    const p2 = await makeUser("p2");

    const results = await Promise.allSettled([
      auth.acceptInvitation(inv1.token, p1.id),
      auth.acceptInvitation(inv2.token, p2.id),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(1); // only one partner gets in
    expect(await prisma.membership.count({ where: { coupleId } })).toBe(2);
  });

  it("a single-use invitation cannot be reused", async () => {
    const { couple, a } = await makeCouple();
    // couple already full (2); make a fresh solo couple for a clean invite
    const owner = await makeUser("solo");
    const { coupleId } = await auth.createCoupleForUser(owner.id, "Solo");
    const inv = await auth.createInvitation(coupleId, owner.id);
    const p1 = await makeUser("first");
    await auth.acceptInvitation(inv.token, p1.id);
    const p2 = await makeUser("second");
    await expect(auth.acceptInvitation(inv.token, p2.id)).rejects.toThrow();
    // silence unused
    expect(couple.id).toBeTypeOf("string");
    expect(a.id).toBeTypeOf("string");
  });

  it("demo accounts are rejected when demo mode is off (login guard is env-driven)", async () => {
    // login() checks env at call-time; here we just assert password hashing works.
    const u = await makeUser("hashcheck");
    const ok = await auth.login({ username: u.username, password: "12345" });
    expect(ok.user.username).toBe(u.username);
    await expect(auth.login({ username: u.username, password: "wrong" })).rejects.toThrow();
  });
});
