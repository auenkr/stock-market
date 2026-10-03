import assert from "node:assert/strict";
import { createApp } from "../src/server.js";

// Read credentials from the environment; never emit credentials or source HTML.
const app = createApp();
const bindings = { BASE_URL: process.env.BASE_URL, COOKIE: process.env.COOKIE };
const paths = ["/v1/company-search?q=reliance", ...["company-profile", "basic-financials", "company-documents", "peer-comparison", "quarterly-profit-loss", "profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding-pattern", "shareholdings/distribution"].map((resource) => `/v1/${resource}?` + new URLSearchParams({ symbol: "/company/RELIANCE/consolidated/" })), "/v1/list-of-ipo"];
for (const path of paths) {
  const response = await app.request(`http://localhost${path}`, { headers: { "X-API-Key": process.env.API_KEY ?? "" } }, bindings);
  const body = await response.json<any>();
  assert.equal(response.status, 200, `${path}: ${body.code ?? response.status}`);
  assert.equal(response.headers.get("x-data-source"), null);
  const count = [body.financials, body.data, body.rows, body.peers, body.ratios].find(Array.isArray)?.length;
  if (count !== undefined) assert(count > 0, `${path}: no records`);
  console.log(JSON.stringify({ path, status: response.status, records: count, coverage: response.headers.get("x-data-coverage") }));
}
