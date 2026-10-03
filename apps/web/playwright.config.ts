import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  use: { baseURL: "http://127.0.0.1:3105", browserName: "chromium", trace: "retain-on-failure" },
  reporter: "list",
  webServer: {
    command: "node ../../scripts/web-test-server.mjs",
    env: { ENVIRONMENT: process.env.ENVIRONMENT ?? "dev" },
    url: "http://127.0.0.1:3105/documentation",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    timeout: 90_000,
  },
});
