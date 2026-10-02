import assert from "node:assert/strict";
import { test } from "node:test";
import { FinEdgeProvider, FallbackProvider } from "./finedge-provider.js";
import { DataError } from "./screener-provider.js";

test("FinEdge maps upstream errors without exposing source credentials or caching failures", async () => {
  for (const [status, text, code] of [
    [401, "invalid token secret", "SOURCE_AUTH_REQUIRED"], [401, "ER0012 - restricted secret", "SOURCE_PLAN_RESTRICTED"],
    [401, "ER017 - user not premium", "SOURCE_PLAN_RESTRICTED"], [403, "secret", "SOURCE_PLAN_RESTRICTED"],
    [429, "secret", "SOURCE_RATE_LIMITED"], [404, "secret", "NOT_FOUND"], [500, "secret", "UPSTREAM_UNAVAILABLE"],
    [200, "not json secret", "UPSTREAM_SCHEMA_CHANGED"], [200, '{"error":"secret"}', "UPSTREAM_SCHEMA_CHANGED"],
  ] as const) {
    let calls = 0;
    const provider = new FinEdgeProvider({ apiKey: "secret", fetcher: async () => { calls++; return new Response(text, { status }); } });
    for (let i = 0; i < 2; i++) await assert.rejects(provider.execute("index/master", {}), error => error instanceof DataError && error.code === code && !error.message.includes("secret"));
    assert.equal(calls, 2);
  }
  const provider = new FinEdgeProvider({ apiKey: "secret", fetcher: async () => { throw new Error("https://source/?token=secret"); } });
  await assert.rejects(provider.execute("index/master", {}), error => error instanceof DataError && error.code === "UPSTREAM_UNAVAILABLE" && !error.message.includes("secret"));
});

test("fallback only handles supported missing datasets, not source failures or excluded history", async () => {
  let calls = 0;
  const secondary = { execute: async () => { calls++; return { body: [] }; } };
  for (const status of [400, 404, 502, 503] as const) {
    const primary = { execute: async () => { throw new DataError("primary failure", status); } };
    await assert.rejects(new FallbackProvider(primary, secondary).execute("financials", {}), (error: unknown) => error instanceof DataError && error.status === status);
  }
  assert.equal(calls, 0);
  const primary = { execute: async () => { throw new DataError("missing"); } };
  assert.deepEqual(await new FallbackProvider(primary, secondary).execute("ratios", {}), { body: [] });
  assert.equal(calls, 1);
  await assert.rejects(new FallbackProvider(primary, secondary).execute("daily-quotes", {}));
  await assert.rejects(new FallbackProvider(primary).execute("notes", {}), (error: unknown) => error instanceof DataError && error.code === "DATASET_UNAVAILABLE");
});
