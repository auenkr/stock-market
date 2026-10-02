import { endpointCatalog, pagedResources, type Schema } from "./endpoint-catalog.js";
import { responseSchemas } from "./reference-schemas.js";
import { coverageDetails } from "./coverage-details.js";
import { legacyResponses, legacySchemas } from "./legacy-schemas.js";

const json = (schema: unknown) => ({ "application/json": { schema } });
const requestHeaders = { "X-Request-ID": { description: "Request identifier for correlating the response with API logs.", schema: { type: "string", format: "uuid" } } };
const quotaHeaders = { ...requestHeaders, "Retry-After": { schema: { type: "integer" }, description: "Seconds until retry, when the quota bucket is exhausted." } };
const error = { description: "Request failed", headers: requestHeaders, content: json({ $ref: "#/components/schemas/Error" }) };
const examples: Record<string, unknown> = { symbol: "ITC", symbols: ["ITC", "RELIANCE"], statement_type: "c", statement_code: "pl", period: "annual", ratio_type: "pr", group: "sub_industry", value: "Diversified FMCG", corp_action: "bonus", action: "bonus", page: 1, stream: false, category: "monthly_index", code: 123, from_date: "2026-10-01", to_date: "2026-10-31" };
const parameterNotes: Record<string, string> = { statement_type: "s = standalone, c = consolidated. Consolidated requests never silently fall back to standalone.", statement_code: "pl = profit and loss, bs = balance sheet, cf = cash flow. See supported combinations in the operation description.", period: "Reporting frequency. Not all reference combinations are available from the current source.", ratio_type: "See operation coverage for supported types; unsupported variations return 501.", symbol: "Exchange symbol. Array parameters serialize as comma-separated values; repeated query values and JSON arrays are also accepted. Batches are capped at 25.", symbols: "One or more exchange symbols. Serialize as comma-separated values (up to 25); JSON arrays and repeated query parameters are also accepted.", page: "One-based source page. Continue with X-Next-Page until empty; filters are applied within each page.", from_date: "Inclusive lower date bound, YYYY-MM-DD.", to_date: "Inclusive upper date bound, YYYY-MM-DD; must be on or after from_date.", stream: "Only false is supported; true requires a live market-data provider and returns 501." };
const responseHeaders = { ...requestHeaders, "X-Data-Coverage": { description: "Current adapters expose partial coverage.", schema: { type: "string", enum: ["partial"] } }, "X-Data-Source": { description: "Independent data source.", schema: { type: "string" } }, "X-Page": { description: "Requested source page, for paginated resources.", schema: { type: "integer" } }, "X-Next-Page": { description: "Next source page; empty when the source exposes no next page.", schema: { type: "string" } } };
const legacy = {
  "/v1/list-of-company": { summary: "List companies", description: "One-based pages of 100 companies. Each row includes a relative company URL for requesting detailed data. Pagination is provided in meta: currentPage, limit, count, isNextPageAvailable, nextPage, and previousPage. Unavailable next and previous pages are null. Missing numeric values may be zero.", parameters: [{ name: "page", in: "query", description: "One-based page; defaults to 1. Page size is fixed at 100.", schema: { type: "integer", minimum: 1, default: 1 }, example: 1 }] },
  "/v1/list-of-ipo": { summary: "List upcoming IPOs", description: "data and ipos contain the same upcoming IPO rows. Supplementary GMP failures leave gmp_percentage null while the primary source remains available.", parameters: [] },
  "/v1/company-search": { summary: "Search companies by name", description: "Non-empty company-name search. data and results contain the same source search results; individual source fields are not constrained further.", parameters: [{ name: "q", in: "query", required: true, description: "Company-name query; surrounding whitespace is removed.", schema: { type: "string" }, example: "reliance" }] },
  "/v1/company-data": { summary: "Get detailed company data", description: "Use the companyUrl returned by company discovery or search. Supports standalone and consolidated company paths. data and companyData contain the same company information. Check amount/baseValue for monetary units. Missing cells may be zero; news may be empty. Historical market prices are not included.", parameters: [{ name: "companyUrl", in: "query", required: true, description: "Relative company path returned by discovery endpoints. Pass it unchanged using URLSearchParams or curl --data-urlencode. Absolute URLs and paths outside /company/ are invalid.", schema: { type: "string" }, example: "/company/id/1286218/" }] },
  "/v1/extract": { summary: "Extract a company dataset", description: "Select a financial statement, ratios, ownership, or peers using endpoint and type. Check amount/baseValue for monetary units. Missing rows may be omitted and missing cells may be zero. Historical market prices are not included.", parameters: [{ name: "endpoint", in: "query", required: true, description: "Relative company path, optionally consolidated; absolute URLs are rejected.", schema: { type: "string" }, example: "/company/ITC/consolidated/" }, { name: "type", in: "query", required: true, description: "Dataset selected from the full company object.", schema: { type: "string", enum: ["quarterly", "profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding", "peers"] }, example: "profit-loss" }] },
};

export function openApi(origin: string) {
  const paths: Record<string, unknown> = {};
  for (const endpoint of endpointCatalog.filter((x) => x.status !== "excluded")) {
    const aliases = [endpoint.path];
    if (endpoint.path.startsWith("/api/v")) aliases.push(endpoint.path.replace(/^\/api/, ""));
    const parameters = endpoint.parameters.map((p) => ({ ...p, description: parameterNotes[p.name] ?? `Reference ${p.name} parameter.`, example: p.name === "ratio_type" && endpoint.resource === "financial-metrics" ? "cu" : examples[p.name] }));
    if (pagedResources.includes(endpoint.resource)) parameters.push({ name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 }, description: parameterNotes.page!, example: 1 });
    const resourceSchema: Schema = endpoint.resource === "corporate-actions" ? { $ref: "#/components/schemas/CorporateActionHistory" } : endpoint.response;
    const response = endpoint.tier === "enterprise" && endpoint.resource !== "quotes" && endpoint.parameters.some((p) => p.name === "symbols")
      ? { oneOf: [resourceSchema, { type: "array", items: resourceSchema }] } : resourceSchema;
    for (const path of aliases) paths[path] = { get: {
      operationId: `get_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      summary: endpoint.title, tags: [endpoint.tier], description: coverageDetails[endpoint.resource] ?? endpoint.limitation,
      parameters, "x-coverage": endpoint.status, "x-resource": endpoint.resource, "x-canonical-path": endpoint.path, "x-alias": path !== endpoint.path,
      responses: { ...(endpoint.status === "partial" ? { "200": { description: "Source-backed subset. Missing fields are null; an empty list is not proof of a complete historical dataset.", headers: responseHeaders, content: json(response) } } : {}),
        "400": { ...error, description: "Invalid, missing or unknown parameter" }, "401": { ...error, description: "Missing, invalid, expired or revoked API key" }, "404": { ...error, description: "Source resource not found" },
        "429": { ...error, description: "Request allowance exceeded. Wait for Retry-After before retrying.", headers: quotaHeaders },
        "501": { ...error, description: "Dataset or requested variation is unavailable" }, "502": { ...error, description: "Data could not be retrieved" }, "503": { ...error, description: "Service temporarily unavailable; retry later" } },
    } };
  }
  for (const [path, operation] of Object.entries(legacy)) {
    const resource = path.split("/").at(-1)!;
    const cached = resource === "company-data" || resource === "extract";
    const headers = { ...requestHeaders, ...(cached ? { "X-Cache": { description: "Response reuse status, when available.", schema: { type: "string", enum: ["HIT"] } } } : {}), ...(resource === "company-data" ? { "Cache-Control": { description: "HTTP cache directive.", schema: { type: "string" } } } : {}) };
    for (const route of [path, path.replace(/^\/v1/, "/api")]) paths[route] = { get: { ...operation, operationId: `get_${route.replace(/\//g, "_").replace(/-/g, "_")}`,
      tags: ["legacy"], "x-coverage": "legacy", "x-alias": route !== path, "x-canonical-path": path, "x-timeout-ms": 60000,
      responses: { "200": { description: "Original field names and units are preserved.", headers, content: json(legacyResponses[resource]) }, "400": { ...error, description: "Missing or invalid input" }, "404": { ...error, description: "Resource not found" }, "429": { ...error, description: "Request allowance exceeded. Wait for Retry-After before retrying.", headers: quotaHeaders }, "500": { ...error, description: "Unexpected service error" }, "502": { ...error, description: "Data could not be retrieved; retry later." } } } };
  }
  paths["/health"] = { get: { operationId: "get_health", tags: ["service"], summary: "Service health", security: [], "x-coverage": "service", responses: { "200": { description: "Process availability; does not verify upstream data freshness", content: json({ type: "object", properties: { status: { type: "string" }, service: { type: "string" }, version: { type: "string" } } }) } } } };
  paths["/v1/coverage"] = { get: { operationId: "get_coverage", tags: ["service"], summary: "Endpoint coverage and limitations", "x-coverage": "service", responses: { "200": { description: "Reference inventory, including excluded routes", content: json({ type: "object" }) }, "429": error } } };
  for (const [path, entry] of Object.entries(paths)) {
    if (path === "/health") continue;
    const operation = (entry as { get: { responses: Record<string, unknown> } }).get;
    operation.responses["401"] = { ...error, description: "Missing, invalid, expired or revoked API key" };
    operation.responses["429"] = { ...error, description: "Your account's shared request allowance is exhausted. Wait for Retry-After before retrying.", headers: quotaHeaders };
    operation.responses["503"] ??= { ...error, description: "Service temporarily unavailable; retry later" };
  }
  const bsFields = ["totalEquity", "equityCapital", "reserves", "liabilities", "equityAndLiabilities", "assets", "capitalWorkInProgress", "inventories", "tradeReceivables", "cashAndCashEquivalents", "tradePayables", "longTermBorrowings", "shortTermBorrowings", "currentAssets", "noncurrentAssets", "currentLiabilities", "noncurrentLiabilities"];
  const cfFields = ["cashFlowsFromOperatingActivities", "cashFlowsFromInvestingActivities", "cashFlowsFromFinancingActivities", "netCashFlow"];
  const statementRow = (fields: string[]) => ({ type: "object", required: ["header", "year", ...fields], properties: { header: { type: "string" }, year: { type: "integer", nullable: true }, ...Object.fromEntries(fields.map((f) => [f, { type: "number", nullable: true, description: "INR (rupees); null when not exposed by the source." }])) } });
  const financials = { type: "object", required: ["symbol", "financials"], properties: { symbol: { type: "string" }, financials: { type: "array", items: { oneOf: [{ $ref: "#/components/schemas/ProfitLossRow" }, { $ref: "#/components/schemas/BalanceSheetRow" }, { $ref: "#/components/schemas/CashFlowRow" }] } } } };
  const CorporateActionHistory = { oneOf: ["bonus", "split", "rights"].map((kind) => ({ type: "object", required: ["symbol", kind], properties: { symbol: { type: "string" }, [kind]: { type: "array", items: { type: "object", required: ["date", "action"], properties: { date: { type: "string", format: "date", nullable: true }, action: { type: "string", nullable: true } } } } } })) };
  return {
    openapi: "3.0.3", info: { title: "Ledgerline Stock Market API", version: "1.2.0", description: "Indian company financials, ownership, corporate actions, and market information for your applications. Coverage varies by dataset; unavailable datasets and query variants return HTTP 501. Historical market prices are not included. Send a valid API key; the default allowance is 10 requests per minute per account, shared across all its keys." },
    security: [{ apiKey: [] }],
    servers: [{ url: origin, description: "API server (configure your running instance)" }],
    tags: [{ name: "personal", description: "Company and market resources" }, { name: "enterprise", description: "Batches of up to 25 symbols; unsupported streaming and all-market variants are explicit" }, { name: "legacy", description: "Original data envelopes" }, { name: "service", description: "Health and coverage" }],
    externalDocs: { description: "Source and coverage notes", url: "https://www.screener.in/" },
    "x-coverage-summary": { total: endpointCatalog.length, partial: endpointCatalog.filter((e) => e.status === "partial").length, unavailable: endpointCatalog.filter((e) => e.status === "unavailable").length, excluded: endpointCatalog.filter((e) => e.status === "excluded").length, inspectedAt: "2026-10-01" },
    "x-data-conventions": ["Compatibility financial statement amounts: INR rupees; EPS: INR per share.", "Profile/quote market capitalization: INR crores.", "Compatibility profitability ratios: fractions; ownership: percentages.", "Compatibility missing source fields: null. Source summaries may be rounded or delayed.", "Legacy company-data/extract values retain amount/baseValue; crore means INR crores. Legacy blank cells may become zero and absent rows may be omitted.", "Date filters apply to the requested source page; follow X-Next-Page for paginated datasets.", "X-Request-ID correlates every API response with request logs."],
    components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "Send your API key in the X-API-Key header." } },
      schemas: { ...responseSchemas, ...legacySchemas, financials, ProfitLossRow: responseSchemas.financials!.properties!.financials!.items!, BalanceSheetRow: statementRow(bsFields), CashFlowRow: statementRow(cfFields), CorporateActionHistory,
        Error: { type: "object", required: ["error", "code"], properties: { error: { type: "string" }, code: { type: "string" }, endpoint: { type: "string" }, docs: { type: "string" } } } } }, paths,
  };
}
