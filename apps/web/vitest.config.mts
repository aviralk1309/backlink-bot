import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});