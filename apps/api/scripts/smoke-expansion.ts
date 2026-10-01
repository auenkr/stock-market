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
  ["/v1/financials/ITC?statement_type=c&statement_code=bs&period=annual", (b) => b.financials.filter((r: any) => r.inventories != null && r.tradeReceivables != null).length],
  ["/v1/shareholdings/pattern/ITC?period=quarterly", (b) => b.rows.reduce((n: number, r: any) => n + r.shareholders.length, 0)],
  ["/v1/shareholdings/pattern/ITC?period=annual", (b) => b.rows.reduce((n: number, r: any) => n + r.shareholders.length, 0)],
  ["/v1/shareholdings/ownership-current/ITC", (b) => b.ownerships.length],
  ["/v1/shareholdings/ownership-history/ITC?period=quarterly", (b) => b.ownership_histories.length],
  ["/enterprise/api/shareholdings/ownership-current?symbols=ITC", (b) => b.ownerships.length],
  ["/v1/shareholdings/summary/ITC?period=quarterly", (b) => b.summary.filter((r: any) => r.totalShareholders != null).length],
  ["/v1/shareholdings/distribution/ITC?period=quarterly", (b) => b.distributions.length],
  ["/v1/dividend/ITC", (b) => b.dividend.filter((r: any) => r.date && r.amount != null).length],
  ["/v1/corporate-actions/bonus/ITC", (b) => b.bonus.length],
  ["/v1/corporate-actions/split/ITC", (b) => b.split.length],
  ["/v1/corporate-actions/rights/NATCOPHARM", (b) => b.rights.length],
  ["/v1/corporate-actions/all?action=bonus", (b) => b.length],
  ["/v1/corporate-actions/all?symbol=ITC", (b) => b.length],
  ["/v1/results-calendar?from_date=2026-10-01&to_date=2026-12-31", (b) => b.length],
  ["/v1/stock-search?group=macro_sector&value=Fast%20Moving%20Consumer%20Goods", (b) => b.symbols.length],
  ["/v1/stock-search?group=industry&value=Automobile%20and%20Auto%20Components", (b) => b.symbols.length],
  ["/v1/stock-search?group=sector&value=Automobiles", (b) => b.symbols.length],
  ["/v1/corp-announcements", (b) => b.length],
];
for (const [path, count] of probes) {
  const res = await app.request(`http://localhost${path}`); const body = await res.json<any>();
  assert.equal(res.status, 200, `${path}: ${body.code ?? res.status}`); const records = count(body); assert(records > 0, `${path}: no mapped records`);
  console.log(JSON.stringify({ path, status: res.status, records, nextPage: res.headers.get("x-next-page") }));
}
console.log(JSON.stringify({ passed: probes.length }));
