import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PLACE_CATEGORIES, placesStatus, searchPlaces } from "../../features/places/osm.js";
import { parse, requireUser } from "../http.js";

export async function placeRoutes(app: FastifyInstance) {
  app.get("/api/places/status", async (_req, reply) => {
    return reply.send(placesStatus());
  });

  app.get("/api/places/categories", async (req, reply) => {
    await requireUser(req);
    return reply.send({
      categories: PLACE_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
    });
  });

  app.get(
    "/api/places/search",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await requireUser(req);
      const { area, category } = parse(
        z.object({
          area: z.string().max(120).default(""),
          category: z.string().max(40),
        }),
        req.query,
      );
      const { area: resolved, results } = await searchPlaces(area, category);
      const status = placesStatus();
      return reply.send({ enabled: true, area: resolved, results, attribution: status.attribution });
    },
  );
}
