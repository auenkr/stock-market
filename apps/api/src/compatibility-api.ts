import { Hono, type Context } from "hono";
import { endpointCatalog, pagedResources, type EndpointContract } from "./endpoint-catalog.js";
import { ScreenerProvider, DataError, type DataProvider, type DataQuery } from "./screener-provider.js";
import { errorDetails, log } from "@stock-market/common/logger";
import { freeCompanySymbols, freeCompaniesAsOf, requireCompanyAccess, type AccessVariables } from "./endpoint-access.js";
import { FinEdgeProvider, FallbackProvider } from "./finedge-provider.js";

export type Bindings = { BASE_URL?: string; COOKIE?: string; FINEDGE_API_KEY?: string; FINEDGE_BASE_URL?: string };
export type ProviderFactory = (bindings: Bindings) => DataProvider;
const providers = new Map<string, DataProvider>();
export const defaultProvider: ProviderFactory = (bindings) => {
  const baseUrl = bindings.BASE_URL ?? (typeof process === "undefined" ? undefined : process.env.BASE_URL) ?? "https://www.screener.in";
  const cookie = bindings.COOKIE ?? (typeof process === "undefined" ? undefined : process.env.COOKIE);
  const apiKey = bindings.FINEDGE_API_KEY ?? (typeof process === "undefined" ? undefined : process.env.FINEDGE_API_KEY);
  const finedgeBaseUrl = bindings.FINEDGE_BASE_URL ?? (typeof process === "undefined" ? undefined : process.env.FINEDGE_BASE_URL);
  const key = `${baseUrl}\n${cookie ?? ""}\n${apiKey ?? ""}\n${finedgeBaseUrl ?? ""}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = new FallbackProvider(new ScreenerProvider({ baseUrl, cookie }), apiKey ? new FinEdgeProvider({ apiKey, baseUrl: finedgeBaseUrl }) : undefined); providers.set(key, provider);
    if (providers.size > 4) providers.delete(providers.keys().next().value!);
  }
  return provider;
};

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validCompanyPath(path: string) {
  return /^\/company\/(?:[A-Z0-9](?:[A-Z0-9&_-]|%26)*|id\/\d+)\/(?:consolidated\/)?$/i.test(path.endsWith("/") ? path : `${path}/`);
}

function validate(c: Context, contract: EndpointContract): DataQuery {
  const query: DataQuery = { ...c.req.query(), ...c.req.param() };
  for (const parameter of contract.parameters) {
    const value = query[parameter.name]?.trim();
    if (value !== undefined) query[parameter.name] = value;
    if (parameter.required && !value) throw new DataError(`${parameter.name} parameter is required`, 400, "INVALID_QUERY");
    if (!value) continue;
    if (parameter.schema.enum && !parameter.schema.enum.includes(value)) throw new DataError(`${parameter.name} must be one of: ${parameter.schema.enum.join(", ")}`, 400, "INVALID_QUERY");
    if (parameter.schema.type === "integer" && !/^\d+$/.test(value)) throw new DataError(`${parameter.name} must be an integer`, 400, "INVALID_QUERY");
    if (parameter.schema.type === "boolean" && !["true", "false"].includes(value)) throw new DataError(`${parameter.name} must be true or false`, 400, "INVALID_QUERY");
    if (parameter.schema.format === "date" && !validDate(value)) throw new DataError(`${parameter.name} must be a valid YYYY-MM-DD date`, 400, "INVALID_QUERY");
  }
  if (query.page && (!/^\d+$/.test(query.page) || !Number.isSafeInteger(Number(query.page)) || Number(query.page) < 1)) throw new DataError("page must be a positive integer", 400, "INVALID_QUERY");
  if (query.from_date && query.to_date && query.from_date > query.to_date) throw new DataError("from_date must not be after to_date", 400, "INVALID_QUERY");
  if (query.stream === "true") throw new DataError("Streaming requires a market-data feed provider");
  const paged = pagedResources.includes(contract.resource);
  const allowed = new Set([...contract.parameters.map((p) => p.name), ...(paged ? ["page"] : [])]);
  // Silently ignoring filters would make the response look more complete than it is.
  for (const name of Object.keys(c.req.query())) if (!allowed.has(name)) throw new DataError(`Unknown query parameter: ${name}`, 400, "INVALID_QUERY");
  return query;
}

export function parseSymbols(value: string | undefined): string[] {
  if (!value) return [];
  let input: unknown = value;
  if (value.startsWith("[")) {
    try { input = JSON.parse(value); } catch { throw new DataError("symbols must be comma-separated or a JSON array", 400, "INVALID_QUERY"); }
  }
  const list = Array.isArray(input) ? input : String(input).split(",");
  if (!list.length || list.some((x) => typeof x !== "string" || !/^[a-z0-9][a-z0-9&_-]{0,49}$/i.test(x.trim()))) throw new DataError("Invalid stock symbol", 400, "INVALID_QUERY");
  return [...new Set(list.map((x: string) => x.trim().toUpperCase()))];
}

export function createCompatibilityApi(providerFactory: ProviderFactory = defaultProvider) {
  const app = new Hono<{ Bindings: Bindings; Variables: AccessVariables }>();
  app.get("/v1/coverage", (c) => c.json({
    inspectedAt: "2026-10-02", source: "https://www.finedgeapi.com/financial-data-api-documentation", dataSource: "https://www.screener.in/", fallbackDataSource: "https://data.finedgeapi.com/",
    accessPolicy: { freeCompanies: freeCompanySymbols, rankedBy: "market-capitalization", asOf: freeCompaniesAsOf, requestsPerMinute: { free: 10, paid: 60 } },
    endpoints: endpointCatalog.map(({ response: _, parameters: __, ...endpoint }) => endpoint),
  }));
  for (const contract of endpointCatalog.filter((x) => x.status !== "excluded")) {
    const paths = [contract.path];
    if (contract.path.startsWith("/api/v")) paths.push(contract.path.replace(/^\/api/, ""));
    for (const path of paths) app.get(path.replace(/\{([^}]+)\}/g, ":$1"), async (c) => {
      try {
        const query = validate(c, contract);
        const plan = c.get("apiPlan") ?? "free";
        if (plan === "free" && contract.tier === "paid") throw new DataError("This endpoint requires a paid plan", 403, "PAID_PLAN_REQUIRED");

        const isQuote = ["quote", "quotes"].includes(contract.resource);
        const params = new URL(c.req.url).searchParams;
        const rawSymbols = params.has("symbols") ? params.getAll("symbols").join(",") : (isQuote ? params.getAll("symbol").join(",") : query.symbol);
        const symbols = parseSymbols(rawSymbols);
        requireCompanyAccess(plan, symbols);
        if (plan === "free" && isQuote && !symbols.length) symbols.push(...freeCompanySymbols);
        if (contract.status === "unavailable") throw new DataError(contract.limitation);
        // A request must remain bounded on an on-demand scraped source. Higher
        // batch sizes require ingestion and a stored company dataset.
        if (symbols.length > 25) throw new DataError("Batches above 25 symbols require a stored dataset provider");
        if (contract.parameters.some((p) => p.name === "symbol" && p.in === "path") && symbols.length !== 1) throw new DataError("A path must contain exactly one symbol", 400, "INVALID_QUERY");
        const provider = providerFactory(c.env ?? {});
        const results = [];
        if (!symbols.length) results.push(await provider.execute(contract.resource, query));
        else for (const symbol of symbols) results.push(await provider.execute(contract.resource, { ...query, symbol }));
        const result = results[0]!;
        for (const [name, value] of Object.entries(result.headers ?? {})) c.header(name, value);
        c.header("Cache-Control", "private, max-age=900");
        c.header("X-Data-Coverage", "partial");
        const body = contract.resource === "quote" ? Object.assign({}, ...results.map((r) => r.body))
          : contract.resource === "quotes" ? results.flatMap((r) => Array.isArray(r.body) ? r.body : [r.body])
          : results.length === 1 ? result.body : results.map((r) => r.body);
        return c.json(body as Record<string, unknown>);
      } catch (error) {
        log(error instanceof DataError && [400, 404, 501].includes(error.status) ? "warn" : "error", "api.dataset.failed", { requestId: c.res.headers.get("X-Request-ID"), path: c.req.path, error: errorDetails(error) });
        const failure = error instanceof DataError ? error : new DataError("Could not load the requested dataset", 502, "UPSTREAM_UNAVAILABLE");
        c.header("Cache-Control", "no-store");
        return c.json({ error: failure.message, code: failure.code, endpoint: contract.path, docs: "/v1/coverage" }, failure.status);
      }
    });
  }
  return app;
}
