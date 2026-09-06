import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

// Load apps/server/.env (if present) before reading process.env.
// Docker/CI inject env vars directly, so a missing file is fine.
// Skip the .env file under test/vitest, where the runner injects env directly.
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(here, "../../../.env");
    if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
      process.loadEnvFile(envPath);
    }
  } catch {
    // ignore — rely on real process env
  }
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DEMO_MODE: bool(false),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  DEFAULT_TIMEZONE: z.string().default("America/New_York"),
  DEFAULT_WEEKDAY: z.coerce.number().min(0).max(6).default(0),
  DEFAULT_TIME: z.string().default("20:00"),
  WORKER_TICK_SECONDS: z.coerce.number().default(30),
  // Run the scheduling worker inline in the API process (single-service SQLite
  // deploy). Set false to run a dedicated worker process instead.
  RUN_WORKER: bool(true),
  // Absolute path to the built web app to serve from the API (single-service
  // deploy). Empty = auto-resolve ../../../web/dist, else skip static serving.
  WEB_DIST_DIR: z.string().optional().default(""),
  TMDB_API_KEY: z.string().optional().default(""),
  TMDB_IMAGE_BASE: z.string().default("https://image.tmdb.org/t/p"),
  WHATSAPP_ENABLED: bool(false),
  WHATSAPP_SESSION_DIR: z.string().default("./data/whatsapp"),
  // Auto-emoji for date ideas (optional — falls back to a keyword map without it).
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  // Calendar invites via Resend (optional — dormant until configured).
  RESEND_API_KEY: z.string().optional().default(""),
  CALENDAR_FROM_EMAIL: z.string().default("Our 52 <onboarding@resend.dev>"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** Demo credentials are only honored when NOT production and DEMO_MODE is on. */
export const demoEnabled = env.DEMO_MODE && env.NODE_ENV !== "production";

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const tmdbEnabled = env.TMDB_API_KEY.length > 0;
export const anthropicEnabled = env.ANTHROPIC_API_KEY.length > 0;
export const emojiAiEnabled = anthropicEnabled;
export const resendEnabled = env.RESEND_API_KEY.length > 0;
