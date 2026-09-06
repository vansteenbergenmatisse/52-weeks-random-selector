import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
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

  return app;
}
