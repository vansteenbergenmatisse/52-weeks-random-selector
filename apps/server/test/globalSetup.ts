import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

/**
 * Create a fresh SQLite schema for the test run. Runs once before all tests.
 * Uses `prisma db push` (no migration history needed for a throwaway test DB);
 * per-test cleanup is handled by resetDb() in helpers.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "file:./test.db";
  // Wipe any leftover test DB so each run starts clean. Path is relative to the
  // schema dir (prisma/), matching how Prisma resolves file: URLs.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    try {
      rmSync(`prisma/test.db${suffix}`, { force: true });
    } catch {
      // ignore
    }
  }
  execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
