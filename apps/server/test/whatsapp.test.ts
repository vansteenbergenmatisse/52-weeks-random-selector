import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import * as selection from "../src/features/selection/service.js";
import { handleInbound } from "../src/features/whatsapp/commands.js";
import { enqueueBroadcast } from "../src/features/whatsapp/outbox.js";
import { getActivation, sendTest } from "../src/features/whatsapp/manager.js";
import { addEntries, makeCouple, resetDb } from "./helpers.js";

const SENDER = "15551230000"; // member A's linked number (authorized reactor)
const OUTSIDER = "15559999999";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

/** Link a member's own WhatsApp (per-user session). */
async function linkMember(coupleId: string, userId: string, phone: string, status = "connected") {
  await prisma.whatsAppSession.create({ data: { coupleId, userId, phone, status } });
}

/**
 * Simulate a result message that was sent out so reactions can link to it. Also
 * links member A with SENDER so inbound from SENDER is authorized (auth is now by
 * the couple's own linked numbers, not a recipient list).
 */
async function seedSentResult(coupleId: string, collectionId: string, aUserId: string, senderUserId: string) {
  const state = await selection.getCurrentState(coupleId, collectionId);
  await linkMember(coupleId, aUserId, SENDER);
  const msg = await prisma.outboundMessage.create({
    data: {
      coupleId,
      collectionId,
      weeklyResultId: state.result!.weeklyResultId,
      revisionNumber: state.result!.revision,
      kind: "result",
      status: "sent",
      chatId: `${SENDER}@c.us`,
      senderUserId,
      waMessageId: "WA_MSG_1",
      body: "result",
    },
  });
  return { state, msg };
}

describe("whatsapp inbound commands", () => {
  it("reaction 🔄 does not change a locked pick, and replays are ignored (dedup)", async () => {
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    const { state } = await seedSentResult(couple.id, dates.id, a.id, b.id);
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
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id, a.id, b.id);

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
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id, a.id, b.id);

    await handleInbound(couple.id, {
      kind: "reaction",
      messageId: "WA_MSG_1",
      emoji: "🔄",
      senderId: `${OUTSIDER}@c.us`, // not either partner's number
      removed: false,
      fromMe: false,
    });
    expect((await selection.getCurrentState(couple.id, dates.id)).revision).toBe(1);
  });

  it("ignores bot-authored (fromMe) events", async () => {
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id, a.id, b.id);

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
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two"]);
    await selection.spin(couple.id, dates.id, { userId: a.id });
    await seedSentResult(couple.id, dates.id, a.id, b.id);

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
    const { couple, a, b, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One", "Two", "Three"]);
    const spun = await selection.spin(couple.id, dates.id, { userId: a.id });
    const { msg } = await seedSentResult(couple.id, dates.id, a.id, b.id);

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

describe("whatsapp per-user linking + mutual reminders", () => {
  it("cross-sends the weekly pick — each partner receives it FROM the other", async () => {
    const { couple, a, b } = await makeCouple();
    await linkMember(couple.id, a.id, "111");
    await linkMember(couple.id, b.id, "222");

    const ids = await enqueueBroadcast({ coupleId: couple.id, kind: "result", body: "This week: picnic" });
    expect(ids).toHaveLength(2);

    const rows = await prisma.outboundMessage.findMany({ where: { coupleId: couple.id } });
    const bySender = Object.fromEntries(rows.map((r) => [r.senderUserId, r.chatId]));
    // b's session sends to a's number; a's session sends to b's number.
    expect(bySender[b.id]).toBe("111@c.us");
    expect(bySender[a.id]).toBe("222@c.us");
  });

  it("broadcasts nothing until BOTH partners are linked", async () => {
    const { couple, a } = await makeCouple();
    await linkMember(couple.id, a.id, "111"); // only one linked
    const ids = await enqueueBroadcast({ coupleId: couple.id, kind: "result", body: "pick" });
    expect(ids).toHaveLength(0);
  });

  it("activates only when both partners are linked", async () => {
    const { couple, a, b } = await makeCouple();
    expect((await getActivation(couple.id)).activated).toBe(false);

    await linkMember(couple.id, a.id, "111");
    expect((await getActivation(couple.id)).activated).toBe(false); // one linked

    await linkMember(couple.id, b.id, "222");
    const act = await getActivation(couple.id);
    expect(act.activated).toBe(true);
    expect(act.linkedCount).toBe(2);
  });

  it("a disconnected session doesn't count toward activation", async () => {
    const { couple, a, b } = await makeCouple();
    await linkMember(couple.id, a.id, "111");
    await linkMember(couple.id, b.id, "222", "disconnected");
    expect((await getActivation(couple.id)).activated).toBe(false);
  });

  it("test message goes FROM you TO your partner when both are linked", async () => {
    const { couple, a, b } = await makeCouple();
    await linkMember(couple.id, a.id, "111");
    await linkMember(couple.id, b.id, "222");

    const res = await sendTest(couple.id, a.id);
    expect(res.ok).toBe(true);
    expect(res.target).toBe("Sam"); // b's display name

    const row = await prisma.outboundMessage.findFirst({ where: { coupleId: couple.id, kind: "test" } });
    expect(row?.senderUserId).toBe(a.id);
    expect(row?.chatId).toBe("222@c.us"); // to b's number
  });

  it("test falls back to yourself when the partner isn't linked", async () => {
    const { couple, a } = await makeCouple();
    await linkMember(couple.id, a.id, "111");

    const res = await sendTest(couple.id, a.id);
    expect(res.ok).toBe(true);
    expect(res.target).toBe("yourself");

    const row = await prisma.outboundMessage.findFirst({ where: { coupleId: couple.id, kind: "test" } });
    expect(row?.chatId).toBe("111@c.us");
  });

  it("refuses the test when you haven't linked", async () => {
    const { couple, a } = await makeCouple();
    const res = await sendTest(couple.id, a.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_linked");
  });
});
