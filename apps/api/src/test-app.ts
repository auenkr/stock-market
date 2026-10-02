import { createApp } from "./server.js";
import type { ProviderFactory } from "./compatibility-api.js";

/** Source/contract tests isolate source behavior from database authorization. */
export function createTestApp(providerFactory?: ProviderFactory) {
  return createApp(providerFactory, async () => ({ status: "allowed", plan: "professional" }));
}
