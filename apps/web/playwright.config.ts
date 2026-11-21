import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env.development.local");
} catch {
  // CI may supply the local Supabase variables directly.
}
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid")
  .hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(
    "E2E build requires local Supabase in .env.development.local",
  );
}

export default defineConfig({
  testDir: "./e2e",
  // Tests share one local database and two fixed users, so run in order.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  // Own a production server: no HMR reloads or silently reused dev process.
  webServer: {
    command: "pnpm build && pnpm start --port 3100",
    timeout: 180_000,
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
  },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    baseURL: "http://localhost:3100",
    // Without these a stuck page waits for the whole test timeout and the
    // failure says nothing. With them it fails fast and names the step.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
