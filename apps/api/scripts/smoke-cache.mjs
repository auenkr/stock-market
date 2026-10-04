import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { workerBuildOptions } from "./build.mjs";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = await import(wranglerRequire.resolve("miniflare"));
const scraperRequire = createRequire(new URL("../../../packages/scraper/package.json", import.meta.url));
const { createClient } = await import(scraperRequire.resolve("redis"));
assert(process.env.VALKEY_URL, "Set VALKEY_URL to run the live SDK/Workers smoke check");
const prefix = `stock-market:smoke:${crypto.randomUUID()}`;
const fixture = await readFile(new URL("../src/fixtures/company.html", import.meta.url), "utf8");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const result = await build({ ...workerBuildOptions, write: false, stdin: { resolveDir: root, sourcefile: "cache-smoke.ts", contents: `
import { createApp } from './apps/api/src/server.ts';
import { ScreenerProvider } from './apps/api/src/screener-provider.ts';
import { createRedisCache } from './packages/scraper/src/utils/cache.ts';
let sourceCalls = 0;
const app = createApp((bindings, cache) => new ScreenerProvider({baseUrl: bindings.BASE_URL, cache, fetcher: async (input) => {
  sourceCalls++;
  return String(input).includes('/schedules/') ? Response.json({Inventories: {'Mar 2024':'50'}}) : new Response(${JSON.stringify(fixture)});
}}), async () => ({status:'allowed',plan:'professional'}));
app.get('/counts', c => c.json({sourceCalls}));
app.get('/probe', async c => {
  const cache = createRedisCache(c.env.VALKEY_URL, c.env.VALKEY_CACHE_PREFIX);
  try { const result = await cache.remember('expiry-probe', 1, async () => ({nonce: crypto.randomUUID()})); return c.json(result); }
  finally { await cache.close(); }
});
export default app;
` } });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: result.outputFiles[0].text,
  compatibilityDate: "2026-09-26", compatibilityFlags: ["nodejs_compat"],
  bindings: { VALKEY_URL: process.env.VALKEY_URL, VALKEY_CACHE_PREFIX: prefix, BASE_URL: "https://cache-fixture.invalid" },
}));
const cleanupClient = createClient({ url: process.env.VALKEY_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
cleanupClient.on("error", () => {});
try {
  for (const path of ["/v1/company-profile", "/api/v1/cash-flow", "/v1/balance-sheet", "/api/v1/balance-sheet"]) {
    const response = await mf.dispatchFetch(`http://cache.test${path}?symbol=/company/ACME/`);
    assert.equal(response.status, 200, await response.text());
  }
  assert.deepEqual(await (await mf.dispatchFetch("http://cache.test/counts")).json(), { sourceCalls: 3 });
  const cold = await (await mf.dispatchFetch("http://cache.test/probe")).json();
  const warm = await (await mf.dispatchFetch("http://cache.test/probe")).json();
  assert.equal(cold.hit, false); assert.equal(warm.hit, true); assert.deepEqual(warm.value, cold.value);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = await (await mf.dispatchFetch("http://cache.test/probe")).json();
  assert.equal(expired.hit, false); assert.notDeepEqual(expired.value, cold.value);
  console.info("Valkey TLS + Redis SDK + workerd: shared company/schedule hits and expiry passed");
} finally {
  await mf.dispose();
  try {
    await cleanupClient.connect();
    for await (const keys of cleanupClient.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) if (keys.length) await cleanupClient.del(keys);
  } finally { if (cleanupClient.isOpen) cleanupClient.destroy(); }
}
