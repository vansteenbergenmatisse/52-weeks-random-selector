import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { corsOrigins, env } from "../platform/config/env.js";
import { logger } from "../platform/logger/logger.js";
import { handleError } from "./http.js";
import { authRoutes } from "./routes/auth.routes.js";
import { collectionRoutes } from "./routes/collections.routes.js";
import { entryRoutes } from "./routes/entries.routes.js";
import { resultRoutes } from "./routes/results.routes.js";
import { movieRoutes } from "./routes/movies.routes.js";
import { placeRoutes } from "./routes/places.routes.js";
import { whatsappRoutes } from "./routes/whatsapp.routes.js";
import { calendarRoutes } from "./routes/calendar.routes.js";
import { eventRoutes } from "./routes/events.routes.js";

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: true });

  await app.register(cors, { origin: corsOrigins, credentials: true });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.setErrorHandler((err, _req, reply) => handleError(err, reply));

  app.get("/api/health", async () => ({ ok: true, env: env.NODE_ENV, ts: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(collectionRoutes);
  await app.register(entryRoutes);
  await app.register(resultRoutes);
  await app.register(movieRoutes);
  await app.register(placeRoutes);
  await app.register(whatsappRoutes);
  await app.register(calendarRoutes);
  await app.register(eventRoutes);

  // Single-service deploy: also serve the built web app from this process, so
  // one Railway service (and one origin) hosts both API and frontend. The
  // client uses relative /api paths, so same-origin needs no CORS or proxy.
  // Only activates when a build exists — dev (Vite on :5173) is untouched.
  const webDir =
    env.WEB_DIST_DIR ||
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    // SPA fallback: any non-API GET that didn't match a file returns index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found", message: "Not found" });
    });
    logger.info(`Serving web app from ${webDir}`);
  }

  return app;
}
