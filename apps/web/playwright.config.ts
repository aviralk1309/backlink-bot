import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Tests share one local database and two fixed users, so run in order.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:3000",
    // Without these a stuck page waits for the whole test timeout and the
    // failure says nothing. With them it fails fast and names the step.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});