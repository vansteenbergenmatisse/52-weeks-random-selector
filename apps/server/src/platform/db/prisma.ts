import { PrismaClient } from "@prisma/client";
import { isProd } from "../config/env.js";

export const prisma = new PrismaClient({
  log: isProd ? ["warn", "error"] : ["warn", "error"],
});

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
