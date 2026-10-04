import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import test from "node:test";
import axios, { AxiosError } from "axios";
import { ReadThroughCache, sourceCacheKey, type CacheStore } from "@stock-market/scraper/utils/cache";
import { cachedSourceText, sourceGet } from "@stock-market/scraper/utils/source";
import { getCompanySnapshot } from "@stock-market/scraper/helper/getCompanySnapshot";
import { GetCompanyData } from "@stock-market/scraper/helper/getCompanyData";
import { ScreenerProvider } from "./screener-provider.js";
import { createApp } from "./server.js";

const fixture = readFileSync(new NodeURL("./fixtures/company.html", import.meta.url), "utf8");

class MemoryStore implements CacheStore {
  readonly entries = new Map<string, { value: string; expiresAt: number }>();
  readonly locks = new Map<string, { token: string; expiresAt: number }>();
  closed = 0;
  async get(key: string) {
    const entry = this.entries.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  }
  async acquire(key: string, token: string, leaseMs: number) {
    if ((this.locks.get(key)?.expiresAt ?? 0) > Date.now()) return false;
    this.locks.set(key, { token, expiresAt: Date.now() + leaseMs });
    return true;
  }
  async publish(key: string, token: string, value: string, ttlMs: number) {
    if (this.locks.get(key)?.token === token) this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  async release(key: string, token: string) { if (this.locks.get(key)?.token === token) this.locks.delete(key); }
  async close() { this.closed += 1; }
  expire() { for (const entry of this.entries.values()) entry.expiresAt = 0; }
}

test("separate cache clients coalesce misses, isolate mutable results and fetch again after expiry", async () => {
  const store = new MemoryStore();
  let calls = 0;
  const load = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { rows: [calls] }; };
  const results = await Promise.all(Array.from({ length: 5 }, () => new ReadThroughCache(store, "test").remember("company", 900, load)));
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => !result.hit).length, 1);
  results[0]!.value.rows.push(99);
  assert.deepEqual((await new ReadThroughCache(store, "test").remember("company", 900, load)).value.rows, [1]);
  store.expire();
  assert.equal((await new ReadThroughCache(store, "test").remember("company", 900, load)).hit, false);
  assert.equal(calls, 2);
  assert.equal(store.locks.size, 0);
});

test("failed loads are not cached and derived entries cannot outlive their source", async () => {
  const store = new MemoryStore(); const cache = new ReadThroughCache(store, "test");
  await assert.rejects(cache.remember("failure", 900, async () => { throw new Error("upstream failed"); }));
  assert.equal(store.entries.size, 0); assert.equal(store.locks.size, 0);
  const dependencyExpiry = Date.now() + 1000;
  const result = await cache.remember("derived", 900, async () => [1], () => dependencyExpiry);
  assert.equal(result.expiresAt, dependencyExpiry);
  assert((store.entries.get("test:v1:derived")?.expiresAt ?? Infinity) <= dependencyExpiry);
});

test("cache outages fall back to the source and logs do not expose connection errors", async () => {
  const store = new MemoryStore();
  store.get = async () => { throw new Error("rediss://default:do-not-log@private-host:6379"); };
  const lines: string[] = []; const warn = console.warn;
  console.warn = (message) => { lines.push(message); };
  try {
    const result = await new ReadThroughCache(store, "test").remember("company", 900, async () => ({ valid: true }));
    assert.deepEqual(result.value, { valid: true }); assert.equal(result.hit, false);
    assert(lines.some((line) => line.includes("cache.unavailable")));
    assert(lines.every((line) => !line.includes("do-not-log") && !line.includes("private-host")));
  } finally { console.warn = warn; }
});

test("a company snapshot is reused across provider instances and legacy parsing, with financial mode and source isolation", async () => {
  const store = new MemoryStore(); let calls = 0;
  const provider = (cookie = "test-cookie") => new ScreenerProvider({ baseUrl: "https://source.example", cookie,
    cache: new ReadThroughCache(store, "test"), fetcher: async () => { calls += 1; return new Response(fixture); } });
  const first = provider();
  await first.execute("company-profile", { symbol: "/company/ACME/" });
  await provider().execute("profit-loss", { symbol: "/company/ACME" });
  await provider().execute("cash-flow", { symbol: "/company/ACME/" });
  const snapshot = await getCompanySnapshot("/company/ACME/", { baseUrl: "https://source.example", cookie: "test-cookie", cache: new ReadThroughCache(store, "test") }, async () => { throw new Error("legacy must reuse the parsed snapshot"); });
  assert.equal(snapshot.hit, true); assert.equal(calls, 1);
  snapshot.value.tables["balance-sheet"]![0]!.values.Inventories = 999;
  assert.equal((await provider().snapshot("/company/ACME/")).tables["balance-sheet"]![0]!.values.Inventories, undefined);
  await provider().snapshot("/company/ACME/consolidated/");
  await provider("other-cookie").snapshot("/company/ACME/");
  assert.equal(calls, 3);
  store.expire(); await provider().snapshot("/company/ACME/"); assert.equal(calls, 4);
});

test("schedule/investor responses are shared across endpoints and fetch/Axios, including standalone query normalization", async () => {
  const store = new MemoryStore(); const requests: string[] = [];
  const source = { baseUrl: "https://source.example", cookie: "test", cache: new ReadThroughCache(store, "test") };
  const provider = () => new ScreenerProvider({ ...source, cache: new ReadThroughCache(store, "test"), fetcher: async (input) => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search);
    if (url.pathname.includes("/schedules/")) return Response.json({ Inventories: { "Mar 2024": "50" } });
    if (url.pathname.includes("/investors/")) return Response.json({ Founder: { "Jun 2024": "51" } });
    return new Response(fixture);
  } });
  await provider().execute("balance-sheet", { symbol: "/company/ACME/" });
  await provider().execute("balance-sheet", { symbol: "/company/ACME/" });
  const details = await sourceGet("/api/company/42/schedules/?section=balance-sheet&parent=Other Liabilities&consolidated=", source);
  assert.equal(details.cached, true); assert.equal(details.data.Inventories["Mar 2024"], "50");
  await provider().execute("shareholding-pattern", { symbol: "/company/ACME/" });
  const before = requests.length;
  await provider().execute("shareholdings/ownership-current", { symbol: "/company/ACME/" });
  await provider().execute("shareholdings/ownership-history", { symbol: "/company/ACME/", period: "quarterly" });
  assert.equal(requests.length, before);
  assert.equal(requests.filter((path) => path.includes("/schedules/")).length, 2);
  const keys = [...store.entries.keys()];
  assert(keys.every((key) => !key.includes("test-cookie") && !key.includes("https://")));
  assert.equal(await sourceCacheKey("source", new URL("https://source.example/api/company/42/schedules/?parent=Other+Assets&section=balance-sheet"), "test"),
    await sourceCacheKey("source", new URL("https://source.example/api/company/42/schedules/?section=balance-sheet&parent=Other%20Assets&consolidated="), "test"));
});

test("malformed supplementary responses and login pages never enter the shared cache", async () => {
  const store = new MemoryStore(); const cache = new ReadThroughCache(store, "test");
  for (const text of ["<p>Unknown format</p>", "[]", '{"broken":null}', '<title>Login</title>']) {
    await assert.rejects(cachedSourceText(new URL("https://source.example/api/company/42/schedules/?parent=Other+Assets"), { cache }, async () => ({ text })));
  }
  assert.equal(store.entries.size, 0); assert.equal(store.locks.size, 0);
  for (const path of ["/api/company/42/peers", "/company/actions/42/", "/actions/bonus/?p=1", "/upcoming-results/?p=1", "/api/company/search/?q=acme"]) {
    await assert.rejects(cachedSourceText(new URL(path, "https://source.example"), { cache }, async () => ({ text: "<p>Source changed</p>" })));
  }
  assert.equal(store.entries.size, 0);
});

test("legacy redirects cannot poison the shared consolidated snapshot", async () => {
  const store = new MemoryStore(); const previous = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => {
    assert.equal(config.maxRedirects, 0); assert.equal(config.fetchOptions?.redirect, "manual");
    throw new AxiosError("Redirect", "ERR_BAD_RESPONSE", config, undefined, { status: 302, statusText: "Found", headers: { location: "/company/ACME/" }, config, data: "" });
  };
  try {
    await assert.rejects(getCompanySnapshot("/company/ACME/consolidated/", { baseUrl: "https://source.example", cache: new ReadThroughCache(store, "test") }), (error: any) => error.code === "NOT_FOUND" && error.status === 404);
    assert.equal(store.entries.size, 0); assert.equal(store.locks.size, 0);
  } finally { axios.defaults.adapter = previous; }
});

test("legacy financial adapters reuse the canonical snapshot and cached schedules without upstream calls or pacing", async () => {
  const store = new MemoryStore(); const source = { baseUrl: "https://source.example", cookie: "test", cache: new ReadThroughCache(store, "test") };
  await getCompanySnapshot("/company/ACME/", source, async () => fixture);
  const groups: Record<string, string[]> = {
    quarters: ["Sales", "Expenses", "Other Income", "Net Profit"],
    "profit-loss": ["Sales", "Expenses", "Other Income", "Net Profit"],
    "balance-sheet": ["Borrowings", "Other Liabilities", "Fixed Assets", "Other Assets"],
    "cash-flow": ["Cash from Operating Activity", "Cash from Investing Activity", "Cash from Financing Activity"],
  };
  for (const [section, parents] of Object.entries(groups)) for (const parent of parents) {
    const params = new URLSearchParams({ parent, section });
    await cachedSourceText(new URL(`/api/company/42/schedules/?${params}`, source.baseUrl), source, async () => ({ text: JSON.stringify({ Detail: { "Mar 2024": "5" } }) }));
  }
  await cachedSourceText(new URL("/api/company/24/peers", source.baseUrl), source, async () => ({ text: "<table></table>" }));
  const previous = axios.defaults.adapter; let requests = 0;
  axios.defaults.adapter = async (config) => { requests += 1; assert(config.url?.includes("moneycontrol"), "Company and detail requests must hit shared cache"); return { data: [], status: 200, statusText: "OK", headers: {}, config }; };
  try {
    const data = await GetCompanyData("/company/ACME/", { ...source, includeMarketHistory: false });
    assert.equal(data.name, "Acme Ltd"); assert.equal(data.profitAndLossStatements[2]!.sales.value.amount, 120);
    assert.deepEqual(data.balanceSheetStatements[2]!.borrowings.other.Detail, { amount: 5, baseValue: "crore" });
    await GetCompanyData("/company/ACME/", { ...source, cache: new ReadThroughCache(store, "test"), includeMarketHistory: false });
    assert.equal(requests, 1);
  } finally { axios.defaults.adapter = previous; }
});

test("API middleware authorizes warm hits, closes request caches, and shares route aliases", async () => {
  const store = new MemoryStore(); let sourceCalls = 0; let authorizations = 0;
  const app = createApp((bindings, cache) => new ScreenerProvider({ baseUrl: bindings.BASE_URL, cache, fetcher: async () => { sourceCalls += 1; return new Response(fixture); } }),
    async (key) => { authorizations += 1; return key === "valid" ? { status: "allowed", plan: "professional" } : { status: "unauthorized" }; },
    (_, prefix) => new ReadThroughCache(store, prefix));
  const env = { BASE_URL: "https://source.example", VALKEY_URL: "redis://test-only", VALKEY_CACHE_PREFIX: "test" };
  for (const path of ["/v1/company-profile", "/api/v1/company-profile", "/v1/cash-flow"]) {
    const response = await app.request(`${path}?symbol=/company/ACME/`, { headers: { "X-API-Key": "valid" } }, env);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(sourceCalls, 1); assert.equal(store.closed, 3);
  assert.equal((await app.request("/v1/company-profile?symbol=/company/ACME/", {}, env)).status, 401);
  assert.equal(authorizations, 4); assert.equal(sourceCalls, 1); assert.equal(store.closed, 3);
});

test("CACHE_ENABLED=false bypasses Valkey for focused and legacy endpoints", async () => {
  let calls = 0; let cacheFactories = 0;
  const previousFetch = globalThis.fetch;
  const previousAdapter = axios.defaults.adapter;
  const minimal = fixture.replace(/<section id="(?:profit-loss|quarters|balance-sheet|cash-flow|ratios|quarterly-shp)">[\s\S]*?<\/section>/g, "");
  globalThis.fetch = async () => { calls += 1; return new Response(minimal); };
  axios.defaults.adapter = async (config) => {
    calls += 1;
    return { data: config.url?.includes("moneycontrol") ? [] : config.url?.includes("/api/") ? "<table></table>" : minimal, status: 200, statusText: "OK", headers: {}, config };
  };
  const app = createApp(undefined, async () => ({ status: "allowed", plan: "professional" }), () => {
    cacheFactories += 1; throw new Error("Disabled caching must never instantiate Redis");
  });
  const env = { BASE_URL: "https://disabled-cache.example", COOKIE: "", VALKEY_URL: "redis://test-only", CACHE_ENABLED: "false" };
  try {
    for (const path of ["/v1/company-profile", "/api/v1/company-profile", "/v1/company-data", "/api/company-data"]) {
      const before = calls;
      const response = await app.request(`${path}?symbol=/company/ACME/`, {}, env);
      assert.equal(response.status, 200); assert.equal(response.headers.get("x-cache"), null);
      assert(calls > before, "Every sequential request must fetch the source again");
    }
    assert.equal(cacheFactories, 0);
  } finally { globalThis.fetch = previousFetch; axios.defaults.adapter = previousAdapter; }
});

test("without Valkey, sequential company and detail requests have no memory-cache fallback", async () => {
  let calls = 0;
  const provider = new ScreenerProvider({ fetcher: async (input) => {
    calls += 1;
    return String(input).includes("/schedules/") ? Response.json({}) : new Response(fixture);
  } });
  await provider.execute("balance-sheet", { symbol: "/company/ACME/" });
  await provider.execute("balance-sheet", { symbol: "/company/ACME/" });
  assert.equal(calls, 6, "Both calls must fetch the company page and its two available schedules");
});

test("discovery aliases reuse source responses and keep different queries/pages separate", async () => {
  const store = new MemoryStore(); let calls = 0;
  const previous = axios.defaults.adapter;
  const directory = '<table class="data-table"><tbody><tr><td>1</td><td><a href="/company/ACME/">Acme</a></td>' + '<td>1</td>'.repeat(9) + '</tr></tbody></table>';
  axios.defaults.adapter = async (config) => {
    calls += 1;
    const data = config.url?.includes("/search/") ? [{ name: "Acme", url: "/company/ACME/" }]
      : config.url?.includes("/screens/") ? directory : '<table class="data-table"><tbody></tbody></table>';
    return { data, status: 200, statusText: "OK", headers: {}, config };
  };
  const app = createApp(undefined, async () => ({ status: "allowed", plan: "professional" }), (_, prefix) => new ReadThroughCache(store, prefix));
  const env = { BASE_URL: "https://discovery.example", COOKIE: "", VALKEY_URL: "redis://test-only", VALKEY_CACHE_PREFIX: "test" };
  try {
    for (const resource of ["company-search?q=acme", "list-of-company?page=1", "list-of-ipo"]) {
      const first = await app.request(`/v1/${resource}`, {}, env); assert.equal(first.status, 200);
      const alias = await app.request(`/api/${resource}`, {}, env); assert.equal(alias.status, 200);
      assert.deepEqual(await alias.json(), await first.json());
    }
    assert.equal(calls, 3);
    await app.request("/v1/company-search?q=other", {}, env);
    await app.request("/v1/list-of-company?page=2", {}, env);
    assert.equal(calls, 5);
    for (let i = 0; i < 2; i++) await app.request("/v1/company-search?q=acme", {}, { ...env, CACHE_ENABLED: "false" });
    assert.equal(calls, 7);
  } finally { axios.defaults.adapter = previous; }
});

test("cache stats and timing lines separate hits, misses, coalesced loads and failures", async () => {
  const store = new MemoryStore();
  const lines: string[] = []; const info = console.info; const warn = console.warn;
  console.info = (message) => { lines.push(message); };
  console.warn = (message) => { lines.push(message); };
  try {
    const cache = new ReadThroughCache(store, "test", () => 12.5);
    let calls = 0;
    const miss = await cache.remember("company", 900, async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { rows: [calls] }; });
    const hit = await cache.remember("company", 900, async () => { calls += 1; return { rows: [calls] }; });
    assert.equal(miss.hit, false); assert.equal(hit.hit, true); assert.equal(calls, 1);
    assert(Number.isFinite(miss.durationMs) && hit.durationMs >= 0);
    const coalesced = await Promise.all(Array.from({ length: 3 }, () => cache.remember("coalesced", 900, async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { rows: [calls] }; })));
    assert(coalesced.every((result) => result.hit === false));
    await assert.rejects(cache.remember("broken", 900, async () => { throw new Error("upstream failed"); }));

    const stats = cache.stats();
    assert.equal(stats.connectMs, 12.5);
    assert.equal(stats.failures, 1);
    assert.equal(stats.misses, 2);
    assert.equal(stats.hits, 1);
    assert.equal(stats.operations, 6, "one miss, one hit, one miss with two coalesced waiters and one failure");
    assert(stats.durationMs >= 20, "aggregate time must cover the two loader waits");
    const events = lines.map((line) => JSON.parse(line).event as string);
    assert(events.includes("cache.miss") && events.includes("cache.hit") && events.includes("cache.coalesced") && events.includes("cache.failure"));
    const missLine = JSON.parse(lines.find((line) => JSON.parse(line).event === "cache.miss")!);
    assert(Number.isFinite(missLine.durationMs) && Number.isFinite(missLine.loaderMs) && missLine.locked === true && missLine.ttlSeconds === 900);
    // Only SHA-256 derived keys and counts may appear, never caller supplied material.
    assert(lines.every((line) => !line.includes("test-cookie") && !line.includes("https://")));
  } finally { console.info = info; console.warn = warn; }
});

test("every request reports auth, cache and total time on the log line and the response", async () => {
  const store = new MemoryStore();
  const lines: string[] = []; const info = console.info;
  console.info = (message) => { lines.push(message); };
  try {
    const app = createApp(undefined, async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { status: "allowed", plan: "professional" };
    }, (_, prefix) => new ReadThroughCache(store, prefix));
    const previous = axios.defaults.adapter;
    axios.defaults.adapter = async (config) => ({ data: [{ name: "Acme", url: "/company/ACME/" }], status: 200, statusText: "OK", headers: {}, config });
    try {
      const response = await app.request("/v1/company-search?q=acme", {}, { BASE_URL: "https://timing.example", COOKIE: "", VALKEY_URL: "redis://test-only", VALKEY_CACHE_PREFIX: "test" });
      assert.equal(response.status, 200);
      const authTime = Number(response.headers.get("X-Auth-Time"));
      const cacheTime = Number(response.headers.get("X-Cache-Time"));
      const totalTime = Number(response.headers.get("X-Total-Time"));
      assert(authTime >= 25, "auth must include the authorization round trip");
      assert(cacheTime > 0, "a cold cache still costs a store round trip");
      assert(totalTime >= authTime + cacheTime, "total must cover both stages");

      const entries = lines.map((line) => JSON.parse(line));
      const completed = entries.filter((entry) => entry.event === "api.request.completed").at(-1)!;
      assert.equal(completed.authMs, authTime);
      assert.equal(completed.cacheStats.durationMs, cacheTime);
      assert.equal(completed.cacheStats.misses, 1);
      assert(completed.durationMs >= completed.authMs);
      const auth = entries.filter((entry) => entry.event === "api.auth.completed").at(-1)!;
      assert.equal(auth.status, "allowed"); assert.equal(auth.plan, "professional"); assert(auth.durationMs >= 25);
    } finally { axios.defaults.adapter = previous; }
  } finally { console.info = info; }
});
