import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as entries from "../../features/entries/service.js";
import { parse, requireCouple } from "../http.js";

const entryInput = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  emoji: z.string().max(8).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  cost: z.enum(["free", "$", "$$", "$$$"]).nullable().optional(),
  prep: z.string().max(1000).nullable().optional(),
  tmdbId: z.number().int().nullable().optional(),
  imdbId: z.string().max(20).nullable().optional(),
  posterPath: z.string().max(300).nullable().optional(),
  backdropPath: z.string().max(300).nullable().optional(),
  releaseYear: z.number().int().min(1870).max(2100).nullable().optional(),
});

export async function entryRoutes(app: FastifyInstance) {
  app.get("/api/collections/:collectionId/entries", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    const [list, progress] = await Promise.all([
      entries.listEntries(coupleId, collectionId),
      entries.getProgress(coupleId, collectionId),
    ]);
    return reply.send({ entries: list, progress });
  });

  app.post("/api/collections/:collectionId/entries", async (req, reply) => {
    const { coupleId, user } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    const body = parse(entryInput, req.body);
    return reply.send({ entry: await entries.createEntry(coupleId, collectionId, user.id, body) });
  });

  app.post("/api/collections/:collectionId/entries/bulk", async (req, reply) => {
    const { coupleId, user } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    const body = parse(z.object({ items: z.array(entryInput).min(1).max(500) }), req.body);
    return reply.send(await entries.createEntriesBulk(coupleId, collectionId, user.id, body.items));
  });

  app.patch("/api/entries/:id", async (req, reply) => {
    const { coupleId, user } = await requireCouple(req);
    const { id } = req.params as { id: string };
    const body = parse(entryInput.partial(), req.body);
    return reply.send({ entry: await entries.updateEntry(coupleId, id, user.id, body) });
  });

  app.delete("/api/entries/:id", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { id } = req.params as { id: string };
    return reply.send(await entries.deleteEntry(coupleId, id));
  });

  app.post("/api/entries/:id/restore", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { id } = req.params as { id: string };
    return reply.send(await entries.restoreEntry(coupleId, id));
  });
}
