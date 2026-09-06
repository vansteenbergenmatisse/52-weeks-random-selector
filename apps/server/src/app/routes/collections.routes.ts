import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as collections from "../../features/collections/service.js";
import { parse, requireCouple } from "../http.js";

export async function collectionRoutes(app: FastifyInstance) {
  app.get("/api/collections", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    return reply.send({ collections: await collections.listCollections(coupleId) });
  });

  app.post("/api/collections", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const body = parse(
      z.object({
        name: z.string().min(1).max(60),
        emoji: z.string().max(8).optional(),
        colorKey: z.enum(["red", "blue", "purple", "charcoal"]).optional(),
        targetPerPerson: z.number().int().min(1).max(500).optional(),
      }),
      req.body,
    );
    return reply.send({ collection: await collections.createCollection(coupleId, body) });
  });

  app.patch("/api/collections/:id", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        name: z.string().min(1).max(60).optional(),
        emoji: z.string().max(8).optional(),
        colorKey: z.enum(["red", "blue", "purple", "charcoal"]).optional(),
        targetPerPerson: z.number().int().min(1).max(500).optional(),
        autoSelect: z.boolean().optional(),
        scheduleWeekday: z.number().int().min(0).max(6).optional(),
        scheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        scheduleTimezone: z.string().max(64).optional(),
        notifyEnabled: z.boolean().optional(),
        notifyWeekday: z.number().int().min(0).max(6).nullable().optional(),
        notifyTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        notifyTimezone: z.string().max(64).nullable().optional(),
      }),
      req.body,
    );
    return reply.send({ collection: await collections.updateCollection(coupleId, id, body) });
  });
}
