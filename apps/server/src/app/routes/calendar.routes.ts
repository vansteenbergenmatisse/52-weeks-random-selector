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

  // Manually email the invite for this week's pick to both partners.
  app.post("/api/collections/:collectionId/calendar", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send(await calendar.addResultToCalendar(coupleId, collectionId));
  });
}
