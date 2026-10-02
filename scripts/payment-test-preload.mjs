// Loaded only by the disposable E2E server, before Next/Polar import fetch.
// Keep the override out of application code and reject accidental real billing.
if (!/\/stock_test_\d+_\d+/.test(new URL(process.env.INTEGRATION_DATABASE_URL || "http://invalid").pathname) || process.env.POLAR_ACCESS_TOKEN !== "test-polar-token") {
  throw new Error("Payment transport isolation requires disposable test credentials");
}
const gateway = new URL(process.env.POLAR_TEST_API_URL);
if (gateway.hostname !== "127.0.0.1") throw new Error("Payment fixture must be loopback-only");
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (target.hostname === "api.polar.sh") throw new Error("Production Polar is unavailable to payment tests");
  if (target.hostname !== "sandbox-api.polar.sh") return originalFetch(input, init);
  const rewritten = new URL(target.pathname + target.search, gateway);
  return originalFetch(input instanceof Request ? new Request(rewritten, input) : rewritten, init);
};
