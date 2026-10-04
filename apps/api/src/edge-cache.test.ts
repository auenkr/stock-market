import assert from "node:assert/strict";
import test from "node:test";
import { EdgeSourceCache, type EdgeCacheStore } from "./edge-cache.js";
import { ReadThroughCache, sourceCacheKey, type CacheStore } from "@stock-market/scraper/utils/cache";
import { createApp } from "./server.js";
import axios from "axios";

class MemoryEdge implements EdgeCacheStore {
  entries = new Map<string, Response>();
  reads = 0;
  async match(request: RequestInfo | URL) { this.reads++; return this.entries.get(new Request(request).url)?.clone(); }
  async put(request: RequestInfo | URL, response: Response) { this.entries.set(new Request(request).url, response.clone()); }
}

function sharedStore() {
  const entries = new Map<string, string>();
  let reads = 0;
  const store: CacheStore = {
    get: async (key) => { reads++; return entries.get(key) ?? null; },
    acquire: async () => true,
    publish: async (key, _token, value) => { entries.set(key, value); },
    release: async () => {}, close: async () => {},
  };
  return { store, entries, reads: () => reads };
}

test("edge hits bypass Valkey; edge expiry falls through to a shared hit without scraping", async () => {
  const edge = new MemoryEdge(); const shared = sharedStore(); let loads = 0;
  const cache = () => new EdgeSourceCache(new ReadThroughCache(shared.store, "test"), edge, "https://api.example", "test");
  const load = async () => ({ rows: [++loads] });
  assert.equal((await cache().remember("company", 900, load)).hit, false);
  const reads = shared.reads();
  const hit = await cache().remember("company", 900, load);
  assert.equal(hit.hit, true); assert.equal(shared.reads(), reads);
  hit.value.rows.push(99);
  assert.deepEqual((await cache().remember("company", 900, load)).value.rows, [1]);
  for (const [key, response] of edge.entries) {
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    const entry = await response.json() as Record<string, unknown>;
    edge.entries.set(key, Response.json({ ...entry, edgeExpiresAt: 0 }));
  }
  assert.equal((await cache().remember("company", 900, load)).hit, true);
  assert(shared.reads() > reads); assert.equal(loads, 1);
});

test("edge freshness is capped by source expiry, and expired or malformed entries are ignored", async () => {
  const edge = new MemoryEdge(); const shared = sharedStore(); let loads = 0;
  const cache = new EdgeSourceCache(new ReadThroughCache(shared.store, "test"), edge, "https://api.example", "test");
  const expiry = Date.now() + 10_000;
  const result = await cache.remember("company", 900, async () => ++loads, () => expiry);
  assert.equal(result.expiresAt, expiry);
  const [key, response] = [...edge.entries][0]!;
  assert(Number(response.headers.get("cache-control")!.split("=")[1]) <= 10);
  const entry = await response.json() as { edgeExpiresAt: number; expiresAt: number };
  assert(entry.edgeExpiresAt <= expiry);
  // Even if the platform returns an expired entry, never serve stale data.
  shared.entries.clear();
  edge.entries.set(key, Response.json({ ...entry, expiresAt: 0 }));
  assert.equal((await cache.remember("company", 900, async () => ++loads)).value, 2);
  shared.entries.clear(); edge.entries.set(key, new Response("invalid json"));
  assert.equal((await cache.remember("company", 900, async () => ++loads)).value, 3);
  await cache.remember("already-expired", 900, async () => 1, () => Date.now() - 1);
  assert.equal(edge.entries.size, 1);
});

test("edge keys isolate source credentials, queries and deployment namespaces", async () => {
  const edge = new MemoryEdge(); const shared = sharedStore(); let loads = 0;
  for (const [prefix, url, cookie] of [
    ["prod", "https://source.example/search?q=a", "cookie-a"],
    ["prod", "https://source.example/search?q=b", "cookie-a"],
    ["prod", "https://source.example/search?q=a", "cookie-b"],
    ["stage", "https://source.example/search?q=a", "cookie-a"],
  ] as const) {
    const cache = new EdgeSourceCache(new ReadThroughCache(shared.store, prefix), edge, "https://api.example", prefix!);
    await cache.remember(await sourceCacheKey("source", new URL(url!), cookie), 900, async () => ++loads);
  }
  assert.equal(loads, 4); assert.equal(edge.entries.size, 4);
  assert([...edge.entries.keys()].every((key) => !/cookie|source\.example|\?q=/.test(key)));
});

test("edge failures fall through, source errors are not cached, and publication supports waitUntil", async () => {
  const shared = sharedStore();
  const broken: EdgeCacheStore = { match: async () => { throw new Error("cache unavailable"); }, put: async () => { throw new Error("cache unavailable"); } };
  const cache = new EdgeSourceCache(new ReadThroughCache(shared.store, "test"), broken, "https://api.example", "test");
  assert.equal((await cache.remember("company", 900, async () => 42)).value, 42);
  const edge = new MemoryEdge(); const background: Promise<void>[] = [];
  const healthy = new EdgeSourceCache(new ReadThroughCache(shared.store, "test"), edge, "https://api.example", "test", (promise) => background.push(promise));
  await assert.rejects(healthy.remember("failure", 900, async () => { throw new Error("source failed"); }));
  assert.equal(edge.entries.size, 0);
  await healthy.remember("company", 900, async () => 99);
  assert.equal(background.length, 1); await Promise.all(background);
  assert.equal(edge.entries.size, 1);
});

test("API authorizes every edge hit, enforces quota, and supports independent cache bypass", async (t) => {
  const edge = new MemoryEdge(); const shared = sharedStore(); let sourceCalls = 0; let authorizations = 0;
  const previous = axios.defaults.adapter;
  t.after(() => { axios.defaults.adapter = previous; });
  axios.defaults.adapter = async (config) => {
    sourceCalls++;
    return { data: [{ name: "Acme", url: "/company/ACME/" }], status: 200, statusText: "OK", headers: {}, config };
  };
  const app = createApp(undefined, async (key) => {
    authorizations++;
    return key === "allowed" ? { status: "allowed", plan: "professional" }
      : key === "limited" ? { status: "limited", retryAfter: 10 } : { status: "unauthorized" };
  }, (_, prefix) => new ReadThroughCache(shared.store, prefix), () => edge);
  const env = { BASE_URL: "https://source.example", VALKEY_URL: "redis://test-only" };
  const request = (key: string, overrides = {}) => app.request("https://api.example/v1/company-search?q=acme", { headers: { "X-API-Key": key } }, { ...env, ...overrides });
  assert.equal((await request("allowed")).status, 200);
  const sharedReads = shared.reads();
  const response = await request("allowed");
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(shared.reads(), sharedReads); assert.equal(sourceCalls, 1);
  const edgeReads = edge.reads;
  assert.equal((await request("revoked")).status, 401);
  const limited = await request("limited");
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "10");
  assert.equal(edge.reads, edgeReads); assert.equal(authorizations, 4);
  await request("allowed", { EDGE_CACHE_ENABLED: "false" });
  assert.equal(edge.reads, edgeReads); assert(shared.reads() > sharedReads); assert.equal(sourceCalls, 1);
  await request("allowed", { CACHE_ENABLED: "false" });
  assert.equal(edge.reads, edgeReads); assert.equal(sourceCalls, 2);
});
