import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import * as selection from "../src/features/selection/service.js";
import { handleInbound } from "../src/features/whatsapp/commands.js";
import { resolveTargets } from "../src/features/whatsapp/outbox.js";
import { getActivation } from "../src/features/whatsapp/manager.js";
import { addEntries, makeCouple, resetDb } from "./helpers.js";

const SENDER = "15551230000";
const OUTSIDER = "15559999999";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

/** Simulate a result message that was sent out, so reactions can link to it. */
async function seedSentResult(coupleId: string, collectionId: string) {
  const state = await selection.getCurrentState(coupleId, collectionId);
  await prisma.whatsAppConfig.create({
    data: { coupleId, deliveryMode: "individuals", recipients: JSON.stringify([SENDER]) },
  });
  const msg = await prisma.outboundMessage.create({
    data: {
      coupleId,
      collectionId,
      weeklyResultId: state.result!.weeklyResultId,
      revisionNumber: state.result!.revision,
      kind: "result",
      status: "sent",
      chatId: `${SENDER}@c.us`,
      waMessageId: "WA_MSG_1",
      body: "result",
    },
  });
  return { state, msg };
}

describe("whatsapp inbound commands", () => {
  it("reaction 🔄 does not change a locked pick, and replays are ignored (dedup)", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    const { state } = await seedSentResult(couple.id, dates.id);
    const before = state.result!.title;

    const evt = {
      kind: "reaction" as const,
      messageId: "WA_MSG_1",
      emoji: "🔄",
      senderId: `${SENDER}@c.us`,
      removed: false,
      fromMe: false,
    };
    await handleInbound(couple.id, evt);
    const after1 = await selection.getCurrentState(couple.id, dates.id);
    // The week's pick is locked — 🔄 leaves it untouched.
    expect(after1.revision).toBe(1);
    expect(after1.result!.title).toBe(before);

    // Replay same reaction → still no change.
    await handleInbound(couple.id, evt);
    const after2 = await selection.getCurrentState(couple.id, dates.id);
    expect(after2.revision).toBe(1);
    expect(after2.result!.title).toBe(before);
  });

  it("ignores a REMOVED reaction", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id);

    await handleInbound(couple.id, {
      kind: "reaction",
      messageId: "WA_MSG_1",
      emoji: "🔄",
      senderId: `${SENDER}@c.us`,
      removed: true, // removal
      fromMe: false,
    });
    expect((await selection.getCurrentState(couple.id, dates.id)).revision).toBe(1);
  });

  it("ignores events from unauthorized senders", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id);

    await handleInbound(couple.id, {
      kind: "reaction",
      messageId: "WA_MSG_1",
      emoji: "🔄",
      senderId: `${OUTSIDER}@c.us`,
      removed: false,
      fromMe: false,
    });
    expect((await selection.getCurrentState(couple.id, dates.id)).revision).toBe(1);
  });

  it("ignores bot-authored (fromMe) events", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id);

    await handleInbound(couple.id, {
      kind: "reaction",
      messageId: "WA_MSG_1",
      emoji: "🔄",
      senderId: `${SENDER}@c.us`,
      removed: false,
      fromMe: true,
    });
    expect((await selection.getCurrentState(couple.id, dates.id)).revision).toBe(1);
  });

  it("reply DONE marks the result completed", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id);

    await handleInbound(couple.id, {
      kind: "reply",
      messageId: "REPLY_1",
      quotedMessageId: "WA_MSG_1",
      body: "DONE",
      senderId: `${SENDER}@c.us`,
      chatId: `${SENDER}@c.us`,
      fromMe: false,
    });
    expect((await selection.getCurrentState(couple.id, dates.id)).completed).toBe(true);
  });

  it("ignores a reaction against a superseded result", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    const { msg } = await seedSentResult(couple.id, dates.id);

    // Supersede the sent message's result: remove its pick from the pool, then
    // spin again. spin() discards the stale result and creates a brand-new one
    // (a new weeklyResultId), so the old message now points at a superseded pick.
    await prisma.entry.update({
      where: { id: spun.state.result!.entryId! },
      data: { deletedAt: new Date() },
    });
    await selection.spin(couple.id, dates.id, { userId: a.id });
    const current = await selection.getCurrentState(couple.id, dates.id);
    expect(current.result!.weeklyResultId).not.toBe(msg.weeklyResultId);

    // A stale ✅ DONE on the OLD message must not act on the current pick.
    await handleInbound(couple.id, {
      kind: "reaction",
      messageId: msg.waMessageId!,
      emoji: "✅",
      senderId: `${SENDER}@c.us`,
      removed: false,
      fromMe: false,
    });
    expect((await selection.getCurrentState(couple.id, dates.id)).completed).toBe(false);
  });
});

describe("whatsapp recipient derives from the linked phone", () => {
  it("resolveTargets falls back to the linked phone's own number when none configured", async () => {
    const { couple } = await makeCouple();
    await prisma.whatsAppSession.create({
      data: { coupleId: couple.id, status: "connected", phone: SENDER },
    });
    // No whatsAppConfig / recipients at all → default to the paired device.
    expect(await resolveTargets(couple.id)).toEqual([`${SENDER}@c.us`]);
  });

  it("an explicit recipient overrides the linked-phone fallback", async () => {
    const { couple } = await makeCouple();
    await prisma.whatsAppSession.create({
      data: { coupleId: couple.id, status: "connected", phone: SENDER },
    });
    await prisma.whatsAppConfig.create({
      data: { coupleId: couple.id, deliveryMode: "individuals", recipients: JSON.stringify(["+31612345678"]) },
    });
    expect(await resolveTargets(couple.id)).toEqual(["31612345678@c.us"]);
  });

  it("activates on a linked phone alone — no typed number, no calendar email", async () => {
    const { couple } = await makeCouple();
    await prisma.whatsAppSession.create({
      data: { coupleId: couple.id, status: "connected", phone: SENDER },
    });
    const act = await getActivation(couple.id);
    expect(act.linked).toBe(true);
    expect(act.hasPhone).toBe(true);
    expect(act.hasEmail).toBe(false);
    expect(act.activated).toBe(true);
  });

  it("is not activated until the phone is linked", async () => {
    const { couple } = await makeCouple();
    expect((await getActivation(couple.id)).activated).toBe(false);
    // A disconnected session with a known number still isn't sendable.
    await prisma.whatsAppSession.create({
      data: { coupleId: couple.id, status: "disconnected", phone: SENDER },
    });
    expect((await getActivation(couple.id)).activated).toBe(false);
  });
});
