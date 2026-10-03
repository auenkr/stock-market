import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { ScreenerProvider } from "../src/screener-provider.js";

// Source credentials stay in the environment and are never emitted.
const provider = new ScreenerProvider({ baseUrl: process.env.BASE_URL, cookie: process.env.COOKIE, fetcher: async (input, init) => {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return fetch(input, init);
} });
const app = createApp(() => provider);
const probes: [string, (body: any) => number][] = [
  ["/v1/balance-sheet?symbol=/company/ITC/consolidated/", (b) => b.financials.filter((r: any) => r.inventories != null && r.tradeReceivables != null).length],
  ["/v1/shareholding-pattern?symbol=/company/ITC/", (b) => b.rows.reduce((n: number, r: any) => n + r.shareholders.length, 0)],
  ["/v1/shareholdings/ownership-current?symbol=/company/ITC/", (b) => b.ownerships.length],
  ["/v1/shareholdings/ownership-history?symbol=/company/ITC/&period=quarterly", (b) => b.ownership_histories.length],
  ["/v1/shareholdings/summary?symbol=/company/ITC/&period=quarterly", (b) => b.summary.filter((r: any) => r.totalShareholders != null).length],
  ["/v1/shareholdings/distribution?symbol=/company/ITC/", (b) => b.distributions.length],
  ["/v1/dividend?symbol=/company/ITC/", (b) => b.dividend.filter((r: any) => r.date && r.amount != null).length],
  ["/v1/corporate-actions?symbol=/company/ITC/&action=bonus", (b) => b.actions.length],
  ["/v1/corporate-actions?symbol=/company/ITC/&action=split", (b) => b.actions.length],
  ["/v1/corporate-actions?symbol=/company/NATCOPHARM/&action=rights", (b) => b.actions.length],
  ["/v1/corporate-actions/all?action=bonus", (b) => b.length],
  ["/v1/corporate-actions/all?symbol=/company/ITC/", (b) => b.length],
  ["/v1/results-calendar?from_date=2026-10-01&to_date=2026-12-31", (b) => b.length],
  ["/v1/company-documents?symbol=/company/ITC/", (b) => Object.values(b.documents).reduce<number>((n, group) => n + (group as unknown[]).length, 0)],
];
for (const [path, count] of probes) {
  const res = await app.request(`http://localhost${path}`, { headers: { "X-API-Key": process.env.API_KEY ?? "" } }); const body = await res.json<any>();
  assert.equal(res.status, 200, `${path}: ${body.code ?? res.status}`); const records = count(body); assert(records > 0, `${path}: no mapped records`);
  console.log(JSON.stringify({ path, status: res.status, records, nextPage: res.headers.get("x-next-page") }));
}
console.log(JSON.stringify({ passed: probes.length }));
