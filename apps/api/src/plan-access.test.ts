import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";
import { freeCompanySymbols } from "./endpoint-access.js";

function setup(plan: "free" | "paid") {
  const calls: { resource: string; symbol?: string }[] = [];
  const app = createApp(() => ({ execute: async (resource, query) => {
    calls.push({ resource, symbol: query.symbol });
    return { body: resource === "quote" ? { [query.symbol!]: { price: 1 } } : { symbol: query.symbol } };
  } }), async () => ({ status: "allowed", plan }));
  return { app, calls };
}

test("free company access validates all symbols and aliases before source requests", async () => {
  const { app, calls } = setup("free");
  for (const prefix of ["/v1", "/api/v1"]) {
    for (const symbol of freeCompanySymbols) assert.equal((await app.request(`${prefix}/company-profile/${symbol.toLowerCase()}`)).status, 200);
    for (const path of [`${prefix}/company-profile/TCS`, `${prefix}/basic-financials/ITC?statement_type=c&statement_code=pl`, `${prefix}/peers/TCS`, `${prefix}/quote?symbol=RELIANCE,TCS`, `${prefix}/quote?symbol=RELIANCE&symbol=TCS`, `${prefix}/quote?symbol=%5B%22RELIANCE%22,%22TCS%22%5D`]) {
      const before = calls.length;
      const response = await app.request(path);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json<any>()).code, "FREE_COMPANY_RESTRICTED");
      assert.equal(calls.length, before, "Rejected batches must never touch the source");
    }
  }
  const response = await app.request("/api/v2/quote");
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(await response.json()), [...freeCompanySymbols]);
  assert.deepEqual(calls.slice(-5).map((c) => c.symbol), [...freeCompanySymbols]);
});

test("free accounts cannot bypass paid tiers through compatibility or legacy aliases", async () => {
  const { app, calls } = setup("free");
  for (const path of ["/v1/financials/RELIANCE?statement_type=c&statement_code=pl&period=annual", "/api/v1/financials/RELIANCE?statement_type=c&statement_code=pl&period=annual", "/enterprise/api/company-profile?symbols=RELIANCE", "/v1/company-data?companyUrl=/company/RELIANCE/", "/api/company-data?companyUrl=/company/id/123/", "/v1/extract?endpoint=/company/RELIANCE/&type=ratios", "/api/extract?endpoint=/company/RELIANCE/&type=ratios"]) {
    const response = await app.request(path);
    assert.equal(response.status, 403, path);
    assert.equal((await response.json<any>()).code, "PAID_PLAN_REQUIRED");
  }
  assert.equal(calls.length, 0);
});

test("other free resources stay available, and paid users can access all companies and both tiers", async () => {
  const free = setup("free");
  for (const path of ["/v1/stock-symbols", "/v1/stock-search?group=sector&value=Banking", "/v1/results-calendar?from_date=2026-10-01&to_date=2026-10-02", "/v1/ipo-calendar", "/v1/coverage", "/health"]) assert.equal((await free.app.request(path)).status, 200, path);
  const paid = setup("paid");
  for (const path of ["/v1/company-profile/TCS", "/v1/financials/ITC?statement_type=c&statement_code=pl&period=annual", "/enterprise/api/company-profile?symbols=TCS,ITC"]) assert.equal((await paid.app.request(path)).status, 200, path);
  assert(paid.calls.some((call) => call.symbol === "TCS"));
});
