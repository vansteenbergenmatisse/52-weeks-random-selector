import pino from "pino";
import { isProd } from "../config/env.js";

export const logger = pino({
  level: isProd ? "info" : "debug",
  // Never log secrets: redact common sensitive fields defensively.
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "tokenHash",
      "*.password",
      "*.token",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
});
