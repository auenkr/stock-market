import { freeCompanySymbols, freeCompaniesAsOf } from "./endpoint-access.js";
import { plans } from "@stock-market/db/plans";
import { endpointCatalog, pagedResources, legacyEndpointTiers } from "./endpoint-catalog.js";
import { responseSchemas } from "./reference-schemas.js";
import { coverageDetails } from "./coverage-details.js";
import { legacyResponses, legacySchemas } from "./legacy-schemas.js";
import { endpointOrder, endpointUseCase, userJourney } from "./endpoint-journey.js";
import { visibleApiReference } from "@stock-market/common/api-reference";

const json = (schema: unknown) => ({ "application/json": { schema } });
const requestHeaders = { "X-Request-ID": { description: "Request identifier for correlating the response with API logs.", schema: { type: "string", format: "uuid" } } };
const quotaHeaders = { ...requestHeaders, "Retry-After": { schema: { type: "integer" }, description: "Seconds until retry, when the quota bucket is exhausted." } };
const error = { description: "Request failed", headers: requestHeaders, content: json({ $ref: "#/components/schemas/Error" }) };
const examples: Record<string, unknown> = { symbol: "/company/RELIANCE/consolidated/", period: "quarterly", action: "bonus", page: 1, code: 123, from_date: "2026-10-01", to_date: "2026-10-31" };
const parameterNotes: Record<string, string> = { symbol: "Company URL path returned as symbol by search, company listing, or IPO listing. Pass unchanged. The URL selects standalone or consolidated data. Exchange tickers, absolute URLs, arrays and repeated symbols are not accepted.", period: "Reporting frequency: annual or quarterly.", action: "Optional corporate-action filter: split, bonus, rights, or dividend. Omit to return all corporate actions.", page: "One-based source page. Continue with X-Next-Page until empty; filters are applied within each page.", from_date: "Inclusive lower date bound, YYYY-MM-DD.", to_date: "Inclusive upper date bound, YYYY-MM-DD; must be on or after from_date." };
const responseHeaders = { ...requestHeaders, "X-Data-Coverage": { description: "Current adapters expose partial coverage.", schema: { type: "string", enum: ["partial"] } }, "X-Page": { description: "Requested source page, for paginated resources.", schema: { type: "integer" } }, "X-Next-Page": { description: "Next source page; empty when the source exposes no next page.", schema: { type: "string" } } };
const legacy = {
  "/v1/list-of-company": { summary: "List companies", description: "One-based pages of 100 companies. Each row includes the original company URL as symbol. Pagination is provided in meta: currentPage, limit, count, isNextPageAvailable, nextPage, and previousPage. Unavailable next and previous pages are null. Missing numeric values may be zero.", parameters: [{ name: "page", in: "query", description: "One-based page; defaults to 1. Page size is fixed at 100.", schema: { type: "integer", minimum: 1, default: 1 }, example: 1 }] },
  "/v1/list-of-ipo": { summary: "List upcoming IPOs", description: "data and ipos contain the same upcoming IPO rows. Supplementary GMP failures leave gmp_percentage null while the primary source remains available.", parameters: [] },
  "/v1/company-search": { summary: "Search companies by name", description: "Search by company name. data and results contain the same results. symbol contains the original company URL path, replacing url; pass it unchanged to company endpoints.", parameters: [{ name: "q", in: "query", required: true, description: "Company-name query; surrounding whitespace is removed.", schema: { type: "string" }, example: "reliance" }] },
  "/v1/company-data": { summary: "Get detailed company data", description: "Use the URL-valued symbol returned by discovery. data and companyData contain the same company information, including symbol and website. Check amount/baseValue for monetary units. Missing cells may be zero; news may be empty. Historical market prices are not included.", parameters: [{ name: "symbol", in: "query", required: true, description: parameterNotes.symbol, schema: { type: "string" }, example: "/company/id/1286218/" }] },
  "/v1/extract": { summary: "Extract a company dataset", description: "Select a financial statement, ratios, ownership, or peers using symbol and type. Check amount/baseValue for monetary units. Missing rows may be omitted and missing cells may be zero. Historical market prices are not included.", parameters: [{ name: "symbol", in: "query", required: true, description: parameterNotes.symbol, schema: { type: "string" }, example: "/company/RELIANCE/consolidated/" }, { name: "type", in: "query", required: true, description: "Dataset selected from the full company object.", schema: { type: "string", enum: ["quarterly", "profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding", "peers"] }, example: "profit-loss" }] },
};

export function openApi(origin: string, environment?: string) {
  const paths: Record<string, unknown> = {};
  for (const endpoint of endpointCatalog.filter((x) => x.status !== "excluded")) {
    const aliases = [endpoint.path];
    if (endpoint.path.startsWith("/api/v")) aliases.push(endpoint.path.replace(/^\/api/, ""));
    const parameters = endpoint.parameters.map((p) => ({ ...p, description: parameterNotes[p.name] ?? `Reference ${p.name} parameter.`, example: examples[p.name] }));
    if (pagedResources.includes(endpoint.resource)) parameters.push({ name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 }, description: parameterNotes.page!, example: 1 });
    const response = endpoint.response;
    for (const path of aliases) paths[path] = { get: {
      operationId: `get_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      summary: endpoint.title, tags: [endpointUseCase(endpoint.path).title], description: coverageDetails[endpoint.resource] ?? endpoint.limitation,
      parameters, "x-tier": endpoint.tier, "x-api-style": endpoint.apiStyle, "x-coverage": endpoint.status, "x-resource": endpoint.resource, "x-canonical-path": endpoint.path, "x-alias": path !== endpoint.path,
      responses: { ...(endpoint.status === "partial" ? { "200": { description: "Source-backed subset. Missing fields are null; an empty list is not proof of a complete historical dataset.", headers: responseHeaders, content: json(response) } } : {}),
        "403": { ...error, description: "Personal or Professional required for detailed data, or company outside the Hobby top-five allowlist" }, "400": { ...error, description: "Invalid, missing or unknown parameter" }, "401": { ...error, description: "Missing, invalid, expired or revoked API key" }, "404": { ...error, description: "Source resource not found" },
        "429": { ...error, description: "Request allowance exceeded. Wait for Retry-After before retrying.", headers: quotaHeaders },
        "501": { ...error, description: "Dataset or requested variation is unavailable" }, "502": { ...error, description: "Data could not be retrieved" }, "503": { ...error, description: "Service temporarily unavailable; retry later" } },
    } };
  }
  for (const [path, operation] of Object.entries(legacy)) {
    const resource = path.split("/").at(-1)!;
    const cached = resource === "company-data" || resource === "extract";
    const headers = { ...requestHeaders, ...(cached ? { "X-Cache": { description: "Response reuse status, when available.", schema: { type: "string", enum: ["HIT"] } } } : {}), ...(resource === "company-data" ? { "Cache-Control": { description: "HTTP cache directive.", schema: { type: "string" } } } : {}) };
    for (const route of [path, path.replace(/^\/v1/, "/api")]) paths[route] = { get: { ...operation, operationId: `get_${route.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      tags: [legacyEndpointTiers[resource as keyof typeof legacyEndpointTiers]], "x-tier": legacyEndpointTiers[resource as keyof typeof legacyEndpointTiers], "x-api-style": "legacy", "x-coverage": "legacy", "x-alias": route !== path, "x-canonical-path": path, "x-timeout-ms": 60000,
      responses: { "200": { description: "Original field names and units are preserved.", headers, content: json(legacyResponses[resource]) }, "400": { ...error, description: "Missing or invalid input" }, "404": { ...error, description: "Resource not found" }, "429": { ...error, description: "Request allowance exceeded. Wait for Retry-After before retrying.", headers: quotaHeaders }, "500": { ...error, description: "Unexpected service error" }, "502": { ...error, description: "Data could not be retrieved; retry later." } } } };
  }
  paths["/health"] = { get: { operationId: "get_health", tags: ["free"], "x-tier": "free", "x-api-style": "service", summary: "Service health", security: [], "x-coverage": "service", responses: { "200": { description: "Process availability; does not verify upstream data freshness", content: json({ type: "object", properties: { status: { type: "string" }, service: { type: "string" }, version: { type: "string" } } }) } } } };
  paths["/v1/coverage"] = { get: { operationId: "get_coverage", tags: ["free"], "x-tier": "free", "x-api-style": "service", summary: "Endpoint coverage and limitations", "x-coverage": "service", responses: { "200": { description: "Reference inventory, including excluded routes", content: json({ type: "object" }) }, "429": error } } };
  for (const [path, entry] of Object.entries(paths)) {
    const operation = (entry as { get: { tags: string[]; responses: Record<string, unknown>; "x-canonical-path"?: string; "x-use-case"?: string; "x-order"?: number } }).get;
    const canonicalPath = operation["x-canonical-path"] ?? path;
    operation.tags = [endpointUseCase(canonicalPath).title];
    operation["x-use-case"] = endpointUseCase(canonicalPath).id;
    operation["x-order"] = endpointOrder(canonicalPath);
    if (path === "/health") continue;
    operation.responses["403"] = { ...error, description: "Personal or Professional required (PAID_PLAN_REQUIRED), or company outside the Hobby allowlist (FREE_COMPANY_RESTRICTED)" };
    operation.responses["401"] = { ...error, description: "Missing, invalid, expired or revoked API key" };
    operation.responses["429"] = { ...error, description: "Your account's shared request allowance is exhausted. Wait for Retry-After before retrying.", headers: quotaHeaders };
    operation.responses["503"] ??= { ...error, description: "Service temporarily unavailable; retry later" };
  }
  return visibleApiReference({
    openapi: "3.0.3", info: { title: "Ledgerline Stock Market API", version: "1.2.0", description: "Indian company financials, ownership, corporate actions, and market information for your applications. Coverage varies by dataset; unavailable datasets and query variants return HTTP 501. Historical market prices are not included. Hobby is free without a credit card: free endpoints for RELIANCE, HDFCBANK, BHARTIARTL, ICICIBANK, and SBIN (top five by market capitalization at 2026-10-01 close). Basic (₹199/month) unlocks all supported companies on free endpoints. Personal (₹399/month) and Professional (₹2,499/month) unlock detailed endpoints, subject to source coverage. Only Professional permits commercial use. Send a valid API key. Allowances are 10 requests per minute for Hobby, 60 for Basic, 300 for Personal, and 500 for Professional, shared across all account keys and REST/agent integrations. Paid subscriptions are billed monthly. Paid endpoint labels require Personal or Professional." },
    "x-access-policy": { freeCompanies: freeCompanySymbols, rankedBy: "market-capitalization", asOf: freeCompaniesAsOf, requestsPerMinute: { free: plans.free.requestsPerMinute, basic: plans.basic.requestsPerMinute, personal: plans.personal.requestsPerMinute, professional: plans.professional.requestsPerMinute }, plans, detailedDataPlans: ["personal", "professional"], commercialUse: ["professional"], companyScopedResources: ["company-profile", "basic-financials", "peer-comparison"] },
    security: [{ apiKey: [] }],
    servers: [{ url: origin, description: "API server (configure your running instance)" }],
    tags: userJourney.map((group) => ({ name: group.title, description: group.description })),
    "x-user-journey": userJourney,
    "x-coverage-summary": { total: endpointCatalog.length, partial: endpointCatalog.filter((e) => e.status === "partial").length, unavailable: endpointCatalog.filter((e) => e.status === "unavailable").length, excluded: endpointCatalog.filter((e) => e.status === "excluded").length, inspectedAt: "2026-10-02" },
    "x-data-conventions": ["Company overview and Finance endpoints accept only symbol: the unchanged company URL path from search.", "Financial statement amounts: INR rupees; EPS: INR per share.", "Overview and peer comparison market capitalization: INR crores.", "Profitability ratios: fractions; ownership and peer comparison percentages: percentage points.", "Missing source fields: null. Summaries may be rounded or delayed.", "Internal company-data/extract values retain amount/baseValue; crore means INR crores. Blank cells may become zero and absent rows may be omitted.", "Internal date filters apply to the requested page; follow X-Next-Page for paginated datasets.", "X-Request-ID correlates every API response with request logs."],
    components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "Send your API key in the X-API-Key header." } },
      schemas: { ...responseSchemas, ...legacySchemas,
        Error: { type: "object", required: ["error", "code"], properties: { error: { type: "string" }, code: { type: "string" }, endpoint: { type: "string" }, docs: { type: "string" } } } } },
    paths: Object.fromEntries(Object.entries(paths).sort(([, a], [, b]) => (a as { get: { "x-order": number } }).get["x-order"] - (b as { get: { "x-order": number } }).get["x-order"])),
  }, environment);
}
