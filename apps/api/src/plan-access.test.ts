import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";
import { freeCompanySymbols } from "./endpoint-access.js";

function setup(plan: "free" | "basic" | "personal" | "professional") {
  const calls: { resource: string; symbol?: string }[] = [];
  const app = createApp(() => ({ execute: async (resource, query) => {
    calls.push({ resource, symbol: query.symbol }); return { body: { symbol: query.symbol } };
  } }), async () => ({ status: "allowed", plan }));
  return { app, calls };
}
test("free company access validates URL-valued symbols and aliases before source requests", async () => {
  const { app, calls } = setup("free");
  for (const prefix of ["/v1", "/api/v1"]) {
    for (const symbol of freeCompanySymbols) assert.equal((await app.request(`${prefix}/company-profile?symbol=/company/${symbol.toLowerCase()}/consolidated/`)).status, 200);
    for (const resource of ["company-profile", "basic-financials", "peer-comparison"]) {
      const before = calls.length;
      const response = await app.request(`${prefix}/${resource}?symbol=/company/TCS/`);
      assert.equal(response.status, 403); assert.equal((await response.json<any>()).code, "FREE_COMPANY_RESTRICTED");
      assert.equal(calls.length, before);
    }
    assert.equal((await app.request(`${prefix}/company-profile?symbol=/company/id/123/`)).status, 403);
    assert.equal((await app.request(`${prefix}/company-profile?symbol=/company/RELIANCE/&symbol=/company/TCS/`)).status, 400);
  }
});
test("free accounts cannot bypass paid tiers through company or internal aliases", async () => {
  const { app, calls } = setup("free");
  for (const path of ["/v1/profit-loss?symbol=/company/RELIANCE/", "/api/v1/profit-loss?symbol=/company/RELIANCE/", "/v1/company-documents?symbol=/company/RELIANCE/", "/v1/company-data?symbol=/company/RELIANCE/", "/api/company-data?symbol=/company/id/123/", "/v1/extract?symbol=/company/RELIANCE/&type=ratios", "/api/extract?symbol=/company/RELIANCE/&type=ratios", "/v1/shareholdings/distribution?symbol=/company/RELIANCE/"]) {
    const response = await app.request(path); assert.equal(response.status, 403, path);
    assert.equal((await response.json<any>()).code, "PAID_PLAN_REQUIRED");
  }
  assert.equal(calls.length, 0);
});
test("internal free resources stay available and paid users can access all company URLs", async () => {
  const free = setup("free");
  for (const path of ["/v1/results-calendar?from_date=2026-10-01&to_date=2026-10-02", "/v1/coverage", "/health"]) assert.equal((await free.app.request(path)).status, 200, path);
  for (const plan of ["personal", "professional"] as const) {
    const paid = setup(plan);
    for (const path of ["/v1/company-profile?symbol=/company/TCS/", "/v1/profit-loss?symbol=/company/ITC/consolidated/", "/v1/company-profile?symbol=/company/id/123/"]) assert.equal((await paid.app.request(path)).status, 200, path);
    assert(paid.calls.some((call) => call.symbol === "/company/TCS/"));
  }
});

test("Basic unlocks companies but cannot bypass detailed-data gates through aliases", async () => {
  const { app, calls } = setup("basic");
  for (const prefix of ["/v1", "/api/v1"]) {
    for (const resource of ["company-profile", "basic-financials", "peer-comparison"]) {
      assert.equal((await app.request(`${prefix}/${resource}?symbol=/company/TCS/`)).status, 200);
    }
    for (const resource of ["profit-loss", "balance-sheet", "cash-flow", "ratios", "company-documents", "shareholding-pattern"]) {
      const before = calls.length;
      const response = await app.request(`${prefix}/${resource}?symbol=/company/TCS/`);
      assert.equal(response.status, 403, resource);
      assert.equal((await response.json<any>()).code, "PAID_PLAN_REQUIRED");
      assert.equal(calls.length, before);
    }
  }
  for (const path of ["/v1/company-data?symbol=/company/TCS/", "/api/company-data?symbol=/company/TCS/", "/api/extract?symbol=/company/TCS/&type=ratios"]) {
    assert.equal((await app.request(path)).status, 403, path);
  }
});
