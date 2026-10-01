import assert from "node:assert/strict";
import { createApp } from "../src/server.js";

// Read source credentials from the environment; do not print them or source HTML.
const app = createApp();
const bindings = { BASE_URL: process.env.BASE_URL ?? "https://www.screener.in", COOKIE: process.env.COOKIE };
const paths = [
  "/v1/stock-symbols", "/v1/company-profile/ITC",
  "/v1/financials/ITC?statement_type=s&statement_code=pl&period=annual",
  "/v1/financials/ITC?statement_type=c&statement_code=pl&period=quarterly",
  "/v1/financials/ITC?statement_type=s&statement_code=bs&period=annual",
  "/v1/financials/ITC?statement_type=s&statement_code=cf&period=annual",
  "/v1/ratios/ITC?statement_type=s&ratio_type=pr",
  "/v1/financial-metrics/ITC?statement_type=s&ratio_type=cu",
  "/v1/basic-financials/ITC?statement_type=s&statement_code=pl",
  "/v2/quote?symbol=ITC", "/v1/company-reports/ITC", "/v1/peers/ITC",
  "/v1/stock-search?group=sub_industry&value=Diversified%20FMCG",
  "/v1/shareholdings/pattern/ITC?period=quarterly",
  "/v1/corp-announcements?symbol=ITC", "/v1/credit-ratings?symbol=ITC",
  "/v1/investor-presentations?symbol=ITC", "/v1/ipo-calendar",
  "/enterprise/api/company-profile?symbols=ITC,RELIANCE",
  "/enterprise/api/quotes?symbol=ITC,RELIANCE",
];
for (const path of paths) {
  const response = await app.request(`http://localhost${path}`, {}, bindings);
  const body = await response.json<any>();
  assert.equal(response.status, 200, `${path}: ${body.code ?? response.status}`);
  const count = Array.isArray(body) ? body.length : Array.isArray(body.financials) ? body.financials.length
    : Array.isArray(body.data) ? body.data.length : Array.isArray(body.reports) ? body.reports.length
    : Array.isArray(body.rows) ? body.rows.length : Array.isArray(body.peers) ? body.peers.length : Array.isArray(body.symbols) ? body.symbols.length : undefined;
  if (count !== undefined) assert(count > 0, `${path}: source returned no records`);
  console.log(JSON.stringify({ path, status: response.status, records: count, coverage: response.headers.get("x-data-coverage") }));
}
const transcript = await app.request("http://localhost/v1/investor-call-transcripts?symbol=ITC", {}, bindings);
assert([200, 501].includes(transcript.status));
console.log(JSON.stringify({ path: "/v1/investor-call-transcripts?symbol=ITC", status: transcript.status, sessionDependent: true }));
