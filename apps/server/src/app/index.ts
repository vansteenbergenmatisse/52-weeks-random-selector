import { buildServer } from "./server.js";
import { env } from "../platform/config/env.js";
import { logger } from "../platform/logger/logger.js";
import { prisma } from "../platform/db/prisma.js";
import { startScheduling, stopWorkerLoop } from "../features/scheduling/worker.js";

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`Our 52 API listening on :${env.PORT}`);

  // Single-service (SQLite) deploy: run the scheduling worker inline so one
  // process owns the database file. Set RUN_WORKER=false to run a separate
  // worker process instead (e.g. with an external Postgres).
  if (env.RUN_WORKER) {
    await startScheduling();
    logger.info("Scheduling worker running inline (RUN_WORKER=true)");
  }

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "Shutting down API");
    if (env.RUN_WORKER) stopWorkerLoop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err: String(err) }, "Fatal: API failed to start");
  process.exit(1);
});
