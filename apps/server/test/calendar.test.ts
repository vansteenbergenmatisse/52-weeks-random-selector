import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/platform/db/prisma.js";
import { buildIcs } from "../src/features/calendar/ics.js";
import * as calendar from "../src/features/calendar/service.js";
import * as selection from "../src/features/selection/service.js";
import { addEntries, makeCouple, resetDb } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("calendar .ics", () => {
  it("builds a VEVENT with summary, location, UTC times and both attendees", () => {
    const ics = buildIcs({
      uid: "our52-abc@our52",
      start: new Date("2026-01-04T20:00:00Z"),
      end: new Date("2026-01-04T22:00:00Z"),
      title: "Sunset picnic",
      description: "Bring a blanket",
      location: "Central Park",
      organizerEmail: "org@our52.app",
      attendeeEmails: ["a@x.com", "b@y.com"],
    });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Sunset picnic");
    expect(ics).toContain("LOCATION:Central Park");
    expect(ics).toContain("DTSTART:20260104T200000Z");
    expect(ics).toContain("DTEND:20260104T220000Z");
    expect(ics.match(/ATTENDEE/g)?.length).toBe(2);
  });
});

describe("calendar config + prompt", () => {
  it("adding to calendar is dormant until configured", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One"]);
    await selection.spin(couple.id, dates.id, { source: "web" });
    const res = await calendar.addResultToCalendar(couple.id, dates.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_configured");
  });

  it("enqueues a '👍 add to calendar' prompt only when the couple has configured it", async () => {
    const { couple, a, dates } = await makeCouple();
    await addEntries(dates.id, a.id, ["One"]);
    await prisma.whatsAppConfig.create({
      data: { coupleId: couple.id, deliveryMode: "individuals", recipients: JSON.stringify(["+31612345678"]) },
    });

    const meta = await prisma.collection.findUniqueOrThrow({
      where: { id: dates.id },
      select: { id: true, name: true, kind: true, scheduleTimezone: true },
    });
    const spin = await selection.spin(couple.id, dates.id, { source: "web" });

    // Not configured yet → no prompt.
    await calendar.enqueueCalendarPromptIfConfigured(couple.id, meta, spin.state);
    expect(await prisma.outboundMessage.count({ where: { coupleId: couple.id, kind: "calendar_prompt" } })).toBe(0);

    // Configure calendar, then it enqueues exactly one prompt.
    await prisma.calendarConfig.create({
      data: { coupleId: couple.id, enabled: true, emails: JSON.stringify(["a@x.com", "b@y.com"]) },
    });
    await calendar.enqueueCalendarPromptIfConfigured(couple.id, meta, spin.state);
    expect(await prisma.outboundMessage.count({ where: { coupleId: couple.id, kind: "calendar_prompt" } })).toBe(1);
  });
});
