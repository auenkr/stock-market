import { test as base } from "@playwright/test";
import { db } from "@stock-market/db";

// Close the shared pool once per worker rather than once per test file.
export const test = base.extend<{}, { databaseLifecycle: void }>({
  databaseLifecycle: [async ({}, use) => { await use(); await db.$client.end(); }, { scope: "worker", auto: true }],
});
