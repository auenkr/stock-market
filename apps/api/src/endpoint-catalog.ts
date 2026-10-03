import { coverageDetails } from "./coverage-details.js";
import { endpointOrder } from "./endpoint-journey.js";
export type Schema = { $ref?: string; type?: string; nullable?: boolean; properties?: Record<string, Schema>; required?: string[]; items?: Schema; additionalProperties?: Schema | boolean; enum?: readonly string[]; format?: string; minItems?: number; maxItems?: number; description?: string; example?: unknown; minimum?: number; oneOf?: Schema[]; anyOf?: Schema[] };
type Parameter = { name: string; in: string; required: boolean; schema: Schema; style?: string; explode?: boolean };
export type EndpointContract = { path: string; title: string; tier: "free" | "paid"; apiStyle: "personal"; resource: string; status: "partial" | "unavailable" | "excluded"; limitation: string; parameters: Parameter[]; response: Schema };
const parameter = (name: string, location = "query", values?: string[], required = true): Parameter => ({ name, in: location, required, schema: { type: "string", ...(values ? { enum: values } : {}) } });
const period = () => parameter("period", "query", ["annual", "quarterly"]);
const dates = (): Parameter[] => ["from_date", "to_date"].map((name) => ({ ...parameter(name), schema: { type: "string", format: "date" } }));
const endpoint = (resource: string, title: string, parameters: Parameter[], status: EndpointContract["status"] = "partial", path = `/api/v1/${resource}`, tier: EndpointContract["tier"] = "paid"): EndpointContract => ({ path, title, resource, tier, apiStyle: "personal", status, parameters, response: { $ref: `#/components/schemas/${resource.replace(/[-/]/g, "_")}` }, limitation: status === "excluded" ? "Market history is excluded from this project." : coverageDetails[resource] ?? "The connected source does not supply this dataset." });
const company = (resource: string, title: string, tier: EndpointContract["tier"] = "paid") => endpoint(resource, title, [parameter("symbol")], "partial", `/api/v1/${resource}`, tier);

export const endpointCatalog: EndpointContract[] = [
  company("company-profile", "Company profile", "free"),
  company("basic-financials", "Basic finance", "free"),
  company("company-documents", "Company documents"),
  company("peer-comparison", "Peer comparison", "free"),
  company("quarterly-profit-loss", "Quarterly profit and loss"),
  company("profit-loss", "Profit and loss"),
  company("balance-sheet", "Balance sheet"),
  company("cash-flow", "Cash flow"),
  company("ratios", "Ratios"),
  company("shareholding-pattern", "Shareholding pattern"),
  company("shareholdings/distribution", "Shareholding distribution"),
  endpoint("daily-price-ratios", "Price ratios daily", [parameter("symbol")], "excluded"),
  endpoint("annual-price-ratios", "Price ratios annual", [parameter("symbol")], "excluded"),
  ...["summary", "ownership-current", "ownership-history"].map((kind) => endpoint(`shareholdings/${kind}`, ({ summary: "Ownership structure", "ownership-current": "Current owners", "ownership-history": "Owner history" })[kind]!, [parameter("symbol"), ...(kind === "ownership-current" ? [] : [period()])])),
  endpoint("corporate-actions/all", "Market corporate actions", [parameter("symbol", "query", undefined, false), parameter("action", "query", ["split", "bonus", "rights", "dividend"], false), ...dates().map((p) => ({ ...p, required: false }))]),
  endpoint("corporate-actions", "Company corporate actions", [parameter("symbol"), parameter("action", "query", ["split", "bonus", "rights", "dividend"], false)]),
  company("dividend", "Dividends"),
  endpoint("results-calendar", "Results calendar", dates(), "partial", "/api/v1/results-calendar", "free"),
  endpoint("index/market-price/historical", "Index historical market price", [parameter("index_symbol"), ...dates()], "excluded"),
  endpoint("index/valuation/historical", "Index valuation", [parameter("index_symbol"), ...dates()], "excluded"),
  endpoint("commodity-price", "Commodity price trend", [{ ...parameter("code", "path"), schema: { type: "integer" } }], "excluded", "/api/v1/commodity-price/{code}"),
];
export const legacyEndpointTiers = { "list-of-company": "free", "company-search": "free", "list-of-ipo": "free", "company-data": "paid", extract: "paid" } as const;
endpointCatalog.sort((a, b) => endpointOrder(a.path) - endpointOrder(b.path));
export const pagedResources = ["results-calendar", "corporate-actions/all", "corporate-actions"];
