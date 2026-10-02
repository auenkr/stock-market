import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/payments-live",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000", browserName: "chromium", actionTimeout: 30_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: "list",
  // The real dev app and ngrok webhook remain in the stock-market tmux session.
});
