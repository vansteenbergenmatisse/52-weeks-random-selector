import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    fileParallelism: false, // tests share one database; run serially
    hookTimeout: 30000,
    testTimeout: 30000,
    globalSetup: "./test/globalSetup.ts", // creates the SQLite schema once
    env: {
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "file:./test.db",
      SESSION_SECRET: "test-secret-test-secret-test-secret",
      DEFAULT_TIMEZONE: "America/New_York",
      WHATSAPP_ENABLED: "false",
    },
  },
});
