import { env } from "../platform/config/env.js";
import { logger } from "../platform/logger/logger.js";
import { prisma } from "../platform/db/prisma.js";
import { startWorkerLoop, stopWorkerLoop } from "../features/scheduling/worker.js";
import * as whatsapp from "../features/whatsapp/manager.js";

async function main() {
  logger.info("Our 52 worker starting");

  // Reconnect any previously-paired WhatsApp sessions (best effort).
  if (env.WHATSAPP_ENABLED) {
    const sessions = await prisma.whatsAppSession.findMany({ where: { status: "connected" } });
    for (const s of sessions) {
      whatsapp.connect(s.coupleId).catch((err) =>
        logger.warn({ err: String(err), coupleId: s.coupleId }, "WhatsApp reconnect failed"),
      );
    }
  }

  startWorkerLoop(env.WORKER_TICK_SECONDS);

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
