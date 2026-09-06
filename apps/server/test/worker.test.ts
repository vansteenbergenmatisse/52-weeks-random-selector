import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import { tick } from "../src/features/scheduling/worker.js";
import { addEntries, makeCouple, resetDb } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("scheduling worker", () => {
  it("auto-selects when due, and repeated ticks (restart) never duplicate the draw", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    // Make selection due: schedule anchored in the past, auto on.
    await prisma.collection.update({
      where: { id: dates.id },
      data: { autoSelect: true, cycleStartDate: new Date(Date.now() - 2 * 864e5) },
    });

    await tick(new Date());
    await tick(new Date()); // simulate a restart / second tick
    await tick(new Date());

    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(1);
    expect(couple.id).toBeTypeOf("string");
  });

  it("manual mode does not auto-draw", async () => {
    const { dates, a } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await prisma.collection.update({
      where: { id: dates.id },
      data: { autoSelect: false, cycleStartDate: new Date(Date.now() - 2 * 864e5) },
    });
    await tick(new Date());
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(0);
  });

  it("notification enqueues a reminder in manual mode with no result", async () => {
    const { couple, dates, a } = await makeCouple();
    await addEntries(dates.id, a.id, ["One"]);
    await prisma.whatsAppConfig.create({
      data: { coupleId: couple.id, deliveryMode: "individuals", recipients: JSON.stringify(["15551230000"]) },
    });
    await prisma.collection.update({
      where: { id: dates.id },
      data: { autoSelect: false, notifyEnabled: true, cycleStartDate: new Date(Date.now() - 2 * 864e5) },
    });
    await tick(new Date());
    const reminders = await prisma.outboundMessage.count({ where: { coupleId: couple.id, kind: "reminder" } });
    expect(reminders).toBeGreaterThanOrEqual(1);
  });

  it("selection persists before notification when both are due (result message, not reminder)", async () => {
    const { couple, dates, a } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await prisma.whatsAppConfig.create({
      data: { coupleId: couple.id, deliveryMode: "individuals", recipients: JSON.stringify(["15551230000"]) },
    });
    await prisma.collection.update({
      where: { id: dates.id },
      data: { autoSelect: true, notifyEnabled: true, cycleStartDate: new Date(Date.now() - 2 * 864e5) },
    });
    await tick(new Date());
    expect(await prisma.weeklyResult.count({ where: { collectionId: dates.id } })).toBe(1);
    const resultMsgs = await prisma.outboundMessage.count({ where: { coupleId: couple.id, kind: "result" } });
    const reminderMsgs = await prisma.outboundMessage.count({ where: { coupleId: couple.id, kind: "reminder" } });
    expect(resultMsgs).toBeGreaterThanOrEqual(1); // saved result was notified
    expect(reminderMsgs).toBe(0); // not a "go spin" reminder

    // The message that goes out must name the EXACT entry that was picked, and be
    // tagged with that result's revision (so a later reroll can't send a stale title).
    const result = await prisma.weeklyResult.findFirstOrThrow({
      where: { collectionId: dates.id },
      include: { revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } },
    });
    const pickedTitle = result.revisions[0]!.snapTitle;
    const msg = await prisma.outboundMessage.findFirstOrThrow({
      where: { coupleId: couple.id, kind: "result" },
    });
    expect(msg.body).toContain(pickedTitle);
    expect(msg.weeklyResultId).toBe(result.id);
    expect(msg.revisionNumber).toBe(result.currentRevisionNumber);
  });
});
