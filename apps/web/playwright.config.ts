import { defineConfig, devices } from "@playwright/test";

/**
 * E2E covers the main user flows against a running stack. If servers are already
 * up (pnpm dev), they are reused; otherwise Playwright starts the API + web.
 * Requires the demo seed (pnpm db:seed) so user1/user2 exist.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Chromium-based mobile emulation (avoids needing a separate WebKit install).
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @our52/server start",
      port: 4000,
      reuseExistingServer: true,
      timeout: 60000,
      cwd: "../..",
    },
    {
      command: "pnpm --filter @our52/web dev",
      port: 5173,
      reuseExistingServer: true,
      timeout: 60000,
      cwd: "../..",
    },
  ],
});
