import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import * as selection from "../src/features/selection/service.js";
import { handleInbound } from "../src/features/whatsapp/commands.js";
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
