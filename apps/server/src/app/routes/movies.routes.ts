import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchMovies, discoverMovies, getGenres, matchMovies, tmdbStatus } from "../../features/movies/tmdb.js";
import { detectColumns } from "../../features/movies/aiMatch.js";
import { parse, requireUser } from "../http.js";

export async function movieRoutes(app: FastifyInstance) {
  app.get("/api/movies/status", async (_req, reply) => {
    return reply.send(tmdbStatus());
  });

  app.get(
    "/api/movies/search",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await requireUser(req); // must be logged in to search
      const { q } = parse(z.object({ q: z.string().max(120).default("") }), req.query);
      const status = tmdbStatus();
      if (!status.enabled) return reply.send({ enabled: false, results: [], note: status.note });
      const results = await searchMovies(q);
      return reply.send({ enabled: true, results, attribution: status.attribution });
    },
  );

  app.post(
    "/api/movies/match",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await requireUser(req);
      const { titles } = parse(
        z.object({
          titles: z
            .array(z.object({ title: z.string().min(1).max(200), year: z.number().int().nullable().optional() }))
            .min(1)
            .max(200),
        }),
        req.body,
      );
      const status = tmdbStatus();
      if (!status.enabled) return reply.send({ enabled: false, matches: [], note: status.note });
      const matches = await matchMovies(titles);
      return reply.send({ enabled: true, matches, attribution: status.attribution });
    },
  );

  app.post(
    "/api/movies/detect-columns",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await requireUser(req);
      const { grid } = parse(
        z.object({
          grid: z.array(z.array(z.string().max(300)).max(30)).min(1).max(12),
        }),
        req.body,
      );
      // Returns null when Claude is unavailable/undecided — the client then uses
      // its own text-column heuristic, so this never blocks an import.
      const detection = await detectColumns(grid);
      return reply.send({ detection });
    },
  );

  app.get("/api/movies/genres", async (req, reply) => {
    await requireUser(req);
    const status = tmdbStatus();
    if (!status.enabled) return reply.send({ enabled: false, genres: [], note: status.note });
    return reply.send({ enabled: true, genres: await getGenres() });
  });

  app.get(
    "/api/movies/discover",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await requireUser(req);
      const { mode, genre } = parse(
        z.object({
          mode: z.enum(["trending", "popular", "top_rated"]).default("trending"),
          genre: z.coerce.number().int().positive().optional(),
        }),
        req.query,
      );
      const status = tmdbStatus();
      if (!status.enabled) return reply.send({ enabled: false, results: [], note: status.note });
      const results = await discoverMovies(mode, genre);
      return reply.send({ enabled: true, results, attribution: status.attribution });
    },
  );
}
