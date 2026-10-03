import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL as NodeURL } from "node:url";
import axios from "axios";
import { GetCompanyData } from "@stock-market/scraper/helper/getCompanyData";
import { createTestApp as createApp } from "./test-app.js";
import { createApp as createRuntimeApp } from "./server.js";
import { endpointCatalog, type Schema } from "./endpoint-catalog.js";
import { responseSchemas } from "./reference-schemas.js";
import { ScreenerProvider } from "./screener-provider.js";
import { numericValue, parseCompanySnapshot } from "@stock-market/scraper/helper/getCompanySnapshot";
import { validCompanyPath } from "./compatibility-api.js";
import { endpointUseCase } from "./endpoint-journey.js";

const fixture = readFileSync(new NodeURL("./fixtures/company.html", import.meta.url), "utf8");
const directory = `<table class="data-table"><tbody><tr><td><a href="/company/ACME/consolidated/">Acme Ltd</a></td></tr><tr><td><a href="/company/DEMO/">Demo Ltd</a></td></tr></tbody></table><div class="pagination"><a href="?page=2">Next</a></div>`;
function setup() {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search);
    if (url.pathname.endsWith("/peers")) return new Response(directory);
    if (url.pathname.startsWith("/api/")) return Response.json({});
    if (url.pathname.startsWith("/actions/") || url.pathname.startsWith("/upcoming-results/")) return new Response('<table id="result_list"><tbody></tbody></table>');
    if (url.pathname.startsWith("/company/actions/")) return new Response('<section id="corporate-actions-bonus"><table><tbody></tbody></table></section>');
    if (url.pathname === "/market/") return new Response('<a href="/market/IN01/IN0101/IN010101/">Widgets</a><a href="/market/IN01/IN0101/IN010101/IN010101001/">Widgets</a>');
    if (url.pathname.startsWith("/screens/") || url.pathname.startsWith("/market/IN")) return new Response(directory);
    if (url.pathname.startsWith("/ipo")) return new Response('<table class="data-table"><tbody></tbody></table>');
    return new Response(fixture);
  };
  const provider = new ScreenerProvider({ fetcher });
  return { requests, provider, app: createApp(() => provider) };
}

function assertShape(value: unknown, schema: Schema, path = "response") {
  if (schema.$ref) return assertShape(value, responseSchemas[schema.$ref.split("/").at(-1)!]!, path);
  if (value === null && schema.nullable) return;
  if (!schema.type) return;
  if (schema.type === "array") { assert(Array.isArray(value), path); for (const item of value) assertShape(item, schema.items!, path + "[]"); return; }
  if (schema.type === "object") {
    assert(value && typeof value === "object" && !Array.isArray(value), path);
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) assert(key in record, `${path}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in record) assertShape(record[key], child, `${path}.${key}`);
    if (typeof schema.additionalProperties === "object") for (const [key, item] of Object.entries(record)) if (!schema.properties?.[key]) assertShape(item, schema.additionalProperties, `${path}.${key}`);
    return;
  }
  assert.equal(typeof value, schema.type === "integer" ? "number" : schema.type, path);
  if (schema.type === "number") assert(Number.isFinite(value), path);
}

test("source parser distinguishes missing numbers, extracts identifiers and preserves annual periods", () => {
  assert.equal(numericValue("-"), null); assert.equal(numericValue(""), null); assert.equal(numericValue("0"), 0); assert.equal(numericValue("1,234 Cr."), 1234);
  const snapshot = parseCompanySnapshot(fixture, "ACME", false);
  assert.equal(snapshot.bseCode, "500001"); assert.equal(snapshot.nseCode, "ACME");
  assert.equal(snapshot.classifications.sector?.name, "Widgets");
  assert.equal(snapshot.tables["profit-loss"]?.at(-1)?.values["Tax %"], null);
  assert.equal(snapshot.documents.find((d) => d.kind === "presentation")?.date, null);
});

test("all reference routes are registered with real response shapes or explicit dataset gaps", async () => {
  const { app } = setup();
  const values: Record<string, string> = { symbol: "ACME", symbols: "ACME", statement_type: "s", statement_code: "pl", period: "annual", ratio_type: "pr", group: "sub_industry", value: "Widgets", from_date: "2024-01-01", to_date: "2024-12-31", corp_action: "bonus", category: "monthly_index", code: "123", index_symbol: "NIF50" };
  for (const contract of endpointCatalog) {
    let path = contract.path.replace(/\{([^}]+)\}/g, (_, name: string) => values[name]!);
    const query = new URLSearchParams();
    for (const p of contract.parameters) if (p.required && p.in === "query") query.set(p.name, p.name === "symbol" ? "/company/ACME/" : values[p.name]!);
    path += `?${query}`;
    const response = await app.request(path, { headers: { "X-API-Key": contract.path } });
    const unavailable = contract.status === "unavailable";
    assert.equal(response.status, contract.status === "excluded" ? 404 : unavailable ? 501 : 200, contract.path);
    const body = await response.json<any>();
    if (contract.status === "partial" && !unavailable) { assertShape(body, contract.response, contract.path); assert.equal(response.headers.get("x-data-coverage"), "partial"); }
    else if (unavailable) assert.equal(body.code, "DATASET_UNAVAILABLE");
    if (contract.status !== "excluded" && contract.path.startsWith("/api/v")) {
      const alias = await app.request(path.replace(/^\/api/, ""), { headers: { "X-API-Key": "alias-" + contract.path } });
      assert.equal(alias.status, response.status, "alias " + contract.path);
      assert.deepEqual(await alias.json<any>(), body);
    }
  }
});

test("financials use rupees, EPS stays per share, and annual statements exclude TTM and half-year columns", async () => {
  const { app } = setup();
  const response = await app.request("/v1/profit-loss?symbol=/company/ACME/");
  const { financials } = await response.json<any>();
  assert.equal(financials.length, 4); assert.equal(financials[2].revenueFromOperations, 1_200_000_000);
  assert.equal(financials[2].expenses, 740_000_000); assert.equal(financials[2].EPS, 4.24);
  assert.equal(financials[2].currentTax, null); assert.equal(financials[2].dilutedSharesOutstanding, null);
  assert.equal(financials[2].ebit, 570_000_000); assert.equal(financials[2].ebitda, 670_000_000);
  const bs = await (await app.request("/v1/balance-sheet?symbol=/company/ACME/")).json<any>();
  assert.equal(bs.financials.length, 3); assert.equal(bs.financials[2].assets, 4_000_000_000);
  assert.equal(bs.financials[2].liabilities, 1_000_000_000); assert.equal(bs.financials[2].equityAndLiabilities, 4_000_000_000);
  assert.equal(financials[3].header, "TTM");
  const quarterly = await (await app.request("/v1/quarterly-profit-loss?symbol=/company/ACME/")).json<any>();
  assert.equal(quarterly.financials[0].header, "Jun 2024"); assert.equal(quarterly.financials[0].revenueFromOperations, 350_000_000);
  const cash = await (await app.request("/v1/cash-flow?symbol=/company/ACME/")).json<any>();
  assert.equal(cash.financials[2].cashFlowsFromOperatingActivities, 300_000_000);
});

test("ratio percentages become fractions and retain reported historical metrics", async () => {
  const { app } = setup();
  const r = await (await app.request("/v1/ratios?symbol=/company/ACME/")).json<any>();
  assert.equal(r.ratios[2].effectiveTaxRate, 0.2); assert.equal(r.ratios[2].returnOnCapital, 0.17); assert.equal(r.ratios[2].grossMargin, null);
  assert.equal(r.metrics[2].values["ROCE %"], 17);
});

test("invalid input and unsupported variations are explicit and never fetch a source unnecessarily", async () => {
  const { app, requests } = setup();
  // Keep validation cases independent of the separately tested minute quota.
  const request = (path: string) => app.request(path, { headers: { "X-API-Key": crypto.randomUUID() } });
  for (const path of ["/v1/profit-loss", "/v1/profit-loss?symbol=ACME", "/v1/profit-loss?symbol=https://example.com/company/ACME/", "/v1/profit-loss?symbol=/company/ACME/&period=annual", "/v1/company-documents?symbol=/company/ACME/&from_date=2024-01-01", "/v1/results-calendar?from_date=2024-02-30&to_date=2024-05-01", "/v1/results-calendar?from_date=2024-05-02&to_date=2024-05-01", "/v1/company-data?symbol=foo%2F%2F", "/v1/company-profile?symbol=/company/ACME/&period=annual"]) {
    assert.equal((await request(path)).status, 400, path);
  }
  assert.equal(requests.length, 0);
  for (const contract of endpointCatalog.filter((endpoint) => ["finance", "company-overview"].includes(endpointUseCase(endpoint.path).id))) {
    for (const extra of ["statement_type=c", "statement_code=pl", "period=annual", "ratio_type=pr", "group=sector", "page=1"]) assert.equal((await request(`${contract.path}?symbol=/company/ACME/&${extra}`)).status, 400);
  }
  assert.equal((await request("/v1/extract?symbol=/company/ACME/&type=price-history")).status, 400);
  assert(validCompanyPath("/company/id/123/consolidated/")); assert(!validCompanyPath("/company/ACME/../../admin/"));
});

test("URL-valued symbols select consolidated data without ticker extraction", async () => {
  const { app, requests } = setup();
  const consolidated = await app.request("/v1/profit-loss?symbol=/company/ACME/consolidated/");
  assert.equal(consolidated.status, 200); assert(requests.includes("/company/ACME/consolidated/"));
  const id = await app.request("/v1/company-profile?" + new URLSearchParams({ symbol: "/company/id/123/" }));
  assert.equal(id.status, 200); assert(requests.includes("/company/id/123/"));
  assert.equal((await id.json<any>()).symbol, "/company/id/123/");
  assert.equal((await app.request("/v1/company-profile?symbol=/company/ACME/&symbol=/company/DEMO/")).status, 400);
});

test("overview groups summary, price and analysis separately from historical finance", async () => {
  const { app } = setup();
  const response = await app.request("/v1/basic-financials?symbol=/company/ACME/");
  assert.equal(response.status, 200); assert.equal(response.headers.get("x-data-source"), null);
  const body = await response.json<any>();
  assert.equal(body.symbol, "/company/ACME/"); assert.equal(body.summary["Market Cap"], 1234);
  assert.equal(body.basicFinance.price, 100); assert.equal(body.basicFinance.high52, 150);
  assert.equal(body.basicFinance.tradetime, null); assert.equal(body.about, "A synthetic manufacturing company.");
  assert.equal(body.keyPoints, "Manufactures synthetic widgets.");
  assert.deepEqual(body.analysis, { pros: ["Strong operating cash flow."], cons: ["Concentrated customer base."] });
  assert.equal(body.basic_financials, undefined);
});

test("company documents combines every document group without inventing dates", async () => {
  const { app } = setup();
  const response = await app.request("/v1/company-documents?symbol=/company/ACME/");
  assert.equal(response.status, 200); assert.equal(response.headers.get("x-data-source"), null);
  const { documents } = await response.json<any>();
  assert.equal(documents.annualReports[0].year, 2024);
  assert.equal(documents.announcements[0].date, "2024-05-14");
  assert.equal(documents.creditRatings[0].url, "https://ratings.example/rating.pdf");
  assert.equal(documents.callTranscripts[0].date, null);
  assert.equal(documents.presentations[0].url, "https://acme.example/ppt.pdf");
  assert.deepEqual(documents.other, []);
});

test("deleted discovery, quote, generic statement and document routes are absent", async () => {
  const { app, requests } = setup();
  const spec = await (await app.request("/openapi.json")).json<any>();
  for (const route of ["stock-symbols", "stock-search", "quote", "daily-quotes/ACME", "financials/ACME", "peers/ACME", "company-reports/ACME", "corp-announcements", "credit-ratings", "investor-call-transcripts", "investor-presentations", "shareholdings/pattern/ACME", "name-changes", "symbol-changes", "segment-revenue/ACME", "notes/ACME", "financial-metrics/ACME", "shareholdings/declaration/ACME", "shareholdings/beneficial-owners/ACME", "index/master", "index/market-price/daily-feed", "index/price-returns", "commodity-list", "commodity-pct-change/123", "corporate-actions/split/ACME", "dividend/ACME"]) {
    for (const prefix of ["/v1", "/api/v1"]) assert.equal((await app.request(`${prefix}/${route}`)).status, 404);
  }
  for (const path of ["/v2/quote", "/api/v2/quote", "/v1/ipo-calendar", "/api/v1/ipo-calendar", "/v1/holidays-calendar", "/api/v1/holidays-calendar"]) assert.equal((await app.request(path)).status, 404);
  for (const name of ["stock_symbols", "stock_search", "quote", "daily_quotes", "company_reports", "corp_announcements", "credit_ratings", "investor_call_transcripts", "investor_presentations", "name_changes", "symbol_changes", "segment_revenue", "notes", "financial_metrics", "shareholdings_declaration", "shareholdings_beneficial_owners", "index_master", "index_market_price_daily_feed", "index_price_returns", "commodity_list", "commodity_pct_change", "CorporateActionHistory"]) assert.equal(spec.components.schemas[name], undefined);
  assert.equal(requests.length, 0);
  assert.equal(spec.components.schemas.ipo_calendar, undefined); assert.equal(spec.components.schemas.holidays_calendar, undefined);
});

test("shared source requests are coalesced, upstream failures are not converted into empty datasets", async () => {
  const { provider, requests } = setup();
  await Promise.all([provider.snapshot("/company/ACME/"), provider.snapshot("/company/ACME/")]); assert.equal(requests.length, 1);
  const failing = new ScreenerProvider({ fetcher: async () => new Response("Forbidden", { status: 403 }) });
  const app = createApp(() => failing);
  const response = await app.request("/v1/company-profile?symbol=/company/ACME/"); assert.equal(response.status, 502); assert.equal((await response.json<any>()).code, "UPSTREAM_UNAVAILABLE");
  const login = new ScreenerProvider({ fetcher: async () => new Response('<title>Login</title><form action="/login/">') });
  assert.equal((await (await createApp(() => login).request("/v1/company-profile?symbol=/company/ACME/")).json<any>()).code, "SOURCE_AUTH_REQUIRED");
});

test("legacy public company requests disable market-history source downloads", async () => {
  const adapter = axios.defaults.adapter;
  const requests: string[] = [];
  const html = fixture.replace(/<section id="(?:profit-loss|quarters|balance-sheet|cash-flow|ratios|quarterly-shp)">[\s\S]*?<\/section>/g, "");
  axios.defaults.adapter = async (config) => {
    const url = config.url ?? ""; requests.push(url);
    if (url.includes("/chart/")) throw new Error("Market history must not be downloaded");
    return { data: url.includes("moneycontrol") ? [] : url.includes("/api/") ? "<table></table>" : html, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    const data = await GetCompanyData("/company/ACME/", { includeMarketHistory: false });
    assert.deepEqual(data.metrics, []); assert(requests.length > 0); assert(requests.every((url) => !url.includes("/chart/")));
  } finally { axios.defaults.adapter = adapter; }
});

test("OpenAPI contains responses and resolves schemas for every active reference path; history is absent", async () => {
  const { app } = setup(); const schema = await (await app.request("/openapi.json")).json<any>();
  assert.equal(schema.openapi, "3.0.3"); assert.deepEqual(schema.security, [{ apiKey: [] }]); assert.deepEqual(schema.paths["/health"].get.security, []);
  for (const contract of endpointCatalog) {
    if (contract.status === "excluded") assert.equal(schema.paths[contract.path], undefined, contract.path);
    else { assert(schema.paths[contract.path]?.get?.responses?.["501"], contract.path); assert(schema.components.schemas[contract.response.$ref!.split("/").at(-1)!]); }
  }
  const coverage = await (await app.request("/v1/coverage")).json<any>(); assert.equal(coverage.endpoints.length, endpointCatalog.length);
  assert.equal(coverage.source, undefined); assert.equal(coverage.dataSource, undefined);
  assert(!JSON.stringify(schema).toLowerCase().includes("screener"));
  assert.equal(coverage.fallbackDataSource, undefined);
  assert(!Object.keys(schema.paths).some((path) => path.startsWith("/enterprise/")));
});

test("removed enterprise routes return 404 without fetching the source", async () => {
  const { app, requests } = setup();
  for (const path of ["/enterprise/api/company-profile?symbols=ACME", "/enterprise/api/financials?symbols=ACME", "/enterprise/api/quotes?symbol=ACME", "/enterprise/api/refreshed-stocks"]) {
    assert.equal((await app.request(path)).status, 404, path);
  }
  assert.equal(requests.length, 0);
});

test("account quota failures include retry timing and leave health available", async () => {
  const app = createRuntimeApp(undefined, async () => ({ status: "limited", retryAfter: 42 }));
  const blocked = await app.request("/api/v1/company-profile?symbol=/company/ACME/");
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("retry-after"), "42");
  assert.equal((await app.request("/health")).status, 200);
});
