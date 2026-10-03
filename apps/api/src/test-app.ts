import { createApp } from "./server.js";
import type { ProviderFactory } from "./compatibility-api.js";

/** Source/contract tests isolate source behavior from database authorization. */
export function createTestApp(providerFactory?: ProviderFactory) {
  const app = createApp(providerFactory, async () => ({ status: "allowed", plan: "professional" }));
  const request = app.request.bind(app);
  app.request = (input, init, env, context) => request(input, init, { ENVIRONMENT: "dev", ...env }, context);
  return app;
}
