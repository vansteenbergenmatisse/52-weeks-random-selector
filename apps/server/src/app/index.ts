import { buildServer } from "./server.js";
import { env } from "../platform/config/env.js";
import { logger } from "../platform/logger/logger.js";
import { prisma } from "../platform/db/prisma.js";

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`Our 52 API listening on :${env.PORT}`);

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "Shutting down API");
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
