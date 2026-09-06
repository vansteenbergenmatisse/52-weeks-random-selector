import { logger } from "../platform/logger/logger.js";
import { prisma } from "../platform/db/prisma.js";
import { startScheduling, stopWorkerLoop } from "../features/scheduling/worker.js";

async function main() {
  logger.info("Our 52 worker starting");

  await startScheduling();

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "Shutting down worker");
    stopWorkerLoop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err: String(err) }, "Fatal: worker failed to start");
  process.exit(1);
});
