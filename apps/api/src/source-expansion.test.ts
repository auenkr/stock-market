import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import test from "node:test";
import { createTestApp as createApp } from "./test-app.js";
import { ScreenerProvider } from "./screener-provider.js";
import { endpointCatalog } from "./endpoint-catalog.js";

const fixture = readFileSync(new NodeURL("./fixtures/company.html", import.meta.url), "utf8");
const actions = `<div id="corporate-actions-dividend"><table><tbody><tr><td><div class="font-weight-500">2024</div><div class="sub">May 27</div></td><td><div class="font-weight-500">₹ 6.50</div><div class="sub">Final - FY24</div></td></tr></tbody></table></div><div id="corporate-actions-bonus"><table><tbody><tr><td>2020 Jul 01</td><td><div class="font-weight-500">1:2</div></td></tr></tbody></table></div><div id="corporate-actions-split"><table><tbody><tr><td>2005 Sep 21</td><td><div class="font-weight-500">New face value: 1.00</div><div class="sub">Old face value: 10.00</div></td></tr></tbody></table></div>`;
const admin = `<table id="result_list"><tbody><tr><th><a href="/company/ACME/">Acme Ltd</a></th><td class="field-result_date">14 May 2024</td><td class="field-ex_date">14 May 2024</td><td class="field-ratio">1:2</td><td class="field-div_type">Final</td><td class="field-percent">25</td></tr></tbody></table><p class="paginator"><a href="?p=2">2</a></p>`;
function setup() {
  const requests: string[] = []; const ajax: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search);
    if (new Headers(init?.headers).get("x-requested-with")) ajax.push(url.pathname);
    if (url.pathname.includes("/schedules/")) return Response.json({ Inventories: { "Mar 2024": "50" }, "Trade receivables": { "Mar 2024": "12" }, "Cash Equivalents": { "Mar 2024": "5" }, "Trade Payables": { "Mar 2024": "8" }, "Long term Borrowings": { "Mar 2024": "20" }, "Short term Borrowings": { "Mar 2024": "10" } });
    if (url.pathname.includes("/investors/")) return Response.json(url.pathname.includes("/promoters/") ? { "Acme Founder": { "Mar 2024": "50.00", "Jun 2024": "51.00" }, "Former holder": { "Mar 2024": "0" } } : {});
    if (url.pathname.startsWith("/company/actions/")) return new Response(actions);
    if (url.pathname.startsWith("/actions/") || url.pathname.startsWith("/upcoming-results/")) return new Response(admin);
    if (url.pathname === "/announcements/all/") return new Response('<h1>Latest Announcements</h1><div class="announcement-item"><a href="/company/ACME/">Acme</a><a href="https://www.bseindia.com/example.pdf">Notice <time datetime="2024-05-14T12:30:00+05:30">14 May</time><div class="sub">Detailed notice</div></a></div>');
    return new Response(fixture);
  };
  const provider = new ScreenerProvider({ fetcher }); return { app: createApp(() => provider), requests, ajax };
}

test("expanded schedules and named ownership preserve units, zero and missing periods", async () => {
  const { app, requests } = setup();
  const bs = await (await app.request("/v1/balance-sheet?symbol=/company/ACME/consolidated/")).json<any>();
  assert.equal(bs.financials[2].inventories, 500_000_000); assert.equal(bs.financials[2].tradeReceivables, 120_000_000); assert.equal(bs.financials[0].inventories, null);
  assert(requests.some((r) => r.includes("schedules/") && r.includes("consolidated=true")));
  const pattern = await (await app.request("/v1/shareholding-pattern?symbol=/company/ACME/")).json<any>();
  assert.deepEqual(pattern.rows[0].shareholders[1].data, { "Mar 2024": 0, "Jun 2024": null });
  const current = await (await app.request("/v1/shareholdings/ownership-current?symbol=/company/ACME/")).json<any>();
  assert.equal(current.quarter, "Jun 2024"); assert.equal(current.ownerships.length, 1); assert.equal(current.ownerships[0].shareholder_name, "Acme Founder"); assert.equal(current.ownerships[0].shareholdingPct, 51); assert.equal(current.ownerships[0].totalShares, null);
  const history = await (await app.request("/v1/shareholdings/ownership-history?symbol=/company/ACME/&period=quarterly")).json<any>();
  assert.equal(history.ownership_histories[0].data[1].shareholdingPct, 0); assert.equal(history.ownership_histories[1].data.length, 1);
  const summary = await (await app.request("/v1/shareholdings/summary?symbol=/company/ACME/&period=quarterly")).json<any>();
  assert.equal(summary.summary[1].totalShareholders, 1100); assert.equal(summary.summary[1].totalShares, null);
  const distribution = await (await app.request("/v1/shareholdings/distribution?symbol=/company/ACME/")).json<any>();
  assert.equal(distribution.period, "quarterly"); assert.equal(distribution.distributions[1].distributions[0].data.shareholdingPct, 51);
  assert.equal((await app.request("/v1/shareholdings/distribution?symbol=/company/ACME/&period=annual")).status, 400);
});

test("corporate-action query filters, all-action defaults and rights pagination preserve company identity", async () => {
  const { app, ajax } = setup();
  const div = await (await app.request("/v1/dividend?symbol=/company/ACME/")).json<any>();
  assert.deepEqual(div.dividend[0], { date: "2024-05-27", amount: 6.5, adj_amount: null, dividend_type: "Final", subject: "Final - FY24" }); assert(ajax.some((p) => p.startsWith("/company/actions/")));
  const split = await (await app.request("/v1/corporate-actions?symbol=/company/ACME/&action=split")).json<any>(); assert.equal(split.actions[0].subject, "New face value: 1.00; Old face value: 10.00"); assert.equal(split.actions[0].action, "split");
  const rights = await app.request("/v1/corporate-actions?symbol=/company/ACME/consolidated/&action=rights"); assert.equal(rights.headers.get("x-next-page"), "2"); assert.equal((await rights.json<any>()).actions[0].subject, "1:2");
  const all = await (await app.request("/v1/corporate-actions?symbol=/company/id/42/")).json<any>();
  assert.deepEqual(all.actions.map((action: any) => action.action), ["dividend", "bonus", "split", "rights"]);
  assert(all.actions.every((action: any) => action.symbol === "/company/id/42/"));
  const next = await (await app.request("/v1/corporate-actions?symbol=/company/ACME/&page=2")).json<any>();
  assert.deepEqual(next.actions.map((action: any) => action.action), ["rights"]);
  const feed = await (await app.request("/v1/corporate-actions/all?action=dividend")).json<any>(); assert.equal(feed[0].amount, null); assert.equal(feed[0].subject, "Final: 25% of face value");
  const results = await app.request("/v1/results-calendar?from_date=2024-05-01&to_date=2024-05-31"); assert.equal(results.headers.get("x-next-page"), "2"); assert.equal((await results.json<any>())[0].expected_result_date, "2024-05-14");
  assert.equal((await app.request("/v1/corporate-actions?symbol=/company/ACME/&action=bonus&page=2")).status, 501);
  for (const symbol of ["ACME", "..", "https://example.com/company/ACME/"]) assert.equal((await app.request("/v1/corporate-actions/all?" + new URLSearchParams({ symbol }))).status, 400);
  assert.equal((await app.request("/v1/corporate-actions/all?symbol=/company/ACME/&action=unknown")).status, 400);
  const filtered = await (await app.request("/v1/corporate-actions/all?symbol=/company/ACME/&action=rights&from_date=2024-05-15")).json<any>();
  assert.deepEqual(filtered, []);
});

test("source rate limits and changed detail formats remain explicit failures", async () => {
  const limited = new ScreenerProvider({ fetcher: async () => new Response("Limited", { status: 429 }) });
   const res = await createApp(() => limited).request("/v1/company-profile?symbol=/company/ACME/"); assert.equal(res.status, 503); assert.equal((await res.json<any>()).code, "SOURCE_RATE_LIMITED");
  const changed = new ScreenerProvider({ fetcher: async (url) => new Response(String(url).includes("investors") ? '<p>Unknown response</p>' : fixture) });
   const malformed = await createApp(() => changed).request("/v1/shareholding-pattern?symbol=/company/ACME/"); assert.equal(malformed.status, 502); assert.equal((await malformed.json<any>()).code, "UPSTREAM_SCHEMA_CHANGED");
});

test("Swagger aliases match, schema refs resolve and operation IDs are unique", async () => {
  const { app } = setup(); const spec = await (await app.request("/swagger.json")).json<any>();
  assert.deepEqual(await (await app.request("/openapi.json")).json<any>(), spec); assert.equal((await app.request("/docs")).status, 200);
  const ids = Object.values(spec.paths).map((p: any) => p.get.operationId); assert.equal(new Set(ids).size, ids.length);
  function verifyRefs(value: any) { if (!value || typeof value !== "object") return; if (value.$ref) assert(spec.components.schemas[value.$ref.split("/").at(-1)!], value.$ref); for (const child of Object.values(value)) verifyRefs(child); }
   verifyRefs(spec);
   for (const status of ["partial", "unavailable", "excluded"]) assert.equal(spec["x-coverage-summary"][status], endpointCatalog.filter((endpoint) => endpoint.status === status).length);
   assert.equal(spec["x-coverage-summary"].total, endpointCatalog.length);
});
