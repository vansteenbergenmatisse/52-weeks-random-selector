import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as calendar from "../../features/calendar/service.js";
import { parse, requireCouple } from "../http.js";

export async function calendarRoutes(app: FastifyInstance) {
  app.get("/api/calendar/config", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    return reply.send(await calendar.getCalendarStatus(coupleId));
  });

  app.patch("/api/calendar/config", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const body = parse(
      z.object({
        enabled: z.boolean().optional(),
        emails: z.array(z.string().trim().email().max(200)).max(4).optional(),
        durationMins: z.number().int().min(15).max(1440).optional(),
      }),
      req.body,
    );
    return reply.send(await calendar.updateCalendarConfig(coupleId, body));
  });

  // Keyless self-serve invite for this week's pick: .ics text + Google Calendar
  // link. No Resend key or configured emails required — the web "Add to calendar"
  // button uses this so either partner can add it to their own calendar.
  app.get("/api/collections/:collectionId/calendar/current", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send(await calendar.getCurrentInvite(coupleId, collectionId));
  });

  // Manually email the invite for this week's pick to both partners (needs Resend).
  app.post("/api/collections/:collectionId/calendar", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send(await calendar.addResultToCalendar(coupleId, collectionId));
  });
}
