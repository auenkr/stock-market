import { Hono, type Context } from "hono";
import { endpointCatalog, pagedResources, type EndpointContract } from "./endpoint-catalog.js";
import { ScreenerProvider, DataError, type DataProvider, type DataQuery } from "./screener-provider.js";
import { errorDetails, log } from "@stock-market/common/logger";
import { freeCompanySymbols, freeCompaniesAsOf, requireCompanyAccess, type AccessVariables } from "./endpoint-access.js";
import { endpointUseCase, endpointOrder, userJourney } from "./endpoint-journey.js";
import { validCompanyPath } from "./company-symbol.js";
export { validCompanyPath } from "./company-symbol.js";

export type Bindings = { BASE_URL?: string; COOKIE?: string; ENVIRONMENT?: string };
export type ProviderFactory = (bindings: Bindings) => DataProvider;
const providers = new Map<string, DataProvider>();
export const defaultProvider: ProviderFactory = (bindings) => {
  const baseUrl = bindings.BASE_URL ?? (typeof process === "undefined" ? undefined : process.env.BASE_URL) ?? "https://www.screener.in";
  const cookie = bindings.COOKIE ?? (typeof process === "undefined" ? undefined : process.env.COOKIE);
  const key = `${baseUrl}\n${cookie ?? ""}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = new ScreenerProvider({ baseUrl, cookie }); providers.set(key, provider);
    if (providers.size > 4) providers.delete(providers.keys().next().value!);
  }
  return provider;
};

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
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
  const paged = pagedResources.includes(contract.resource);
  const allowed = new Set([...contract.parameters.map((p) => p.name), ...(paged ? ["page"] : [])]);
  // Silently ignoring filters would make the response look more complete than it is.
  for (const name of Object.keys(c.req.query())) if (!allowed.has(name)) throw new DataError(`Unknown query parameter: ${name}`, 400, "INVALID_QUERY");
  return query;
}

export function createCompatibilityApi(providerFactory: ProviderFactory = defaultProvider) {
  const app = new Hono<{ Bindings: Bindings; Variables: AccessVariables }>();
  app.get("/v1/coverage", (c) => c.json({
    inspectedAt: "2026-10-03",
    accessPolicy: { freeCompanies: freeCompanySymbols, rankedBy: "market-capitalization", asOf: freeCompaniesAsOf, requestsPerMinute: { free: 10, paid: 60 } },
    userJourney,
    endpoints: endpointCatalog.map(({ response: _, parameters: __, ...endpoint }) => ({ ...endpoint, useCase: endpointUseCase(endpoint.path).id, order: endpointOrder(endpoint.path) })),
  }));
  for (const contract of endpointCatalog.filter((x) => x.status !== "excluded")) {
    const paths = [contract.path];
    if (contract.path.startsWith("/api/v")) paths.push(contract.path.replace(/^\/api/, ""));
    for (const path of paths) app.get(path.replace(/\{([^}]+)\}/g, ":$1"), async (c) => {
      try {
        const query = validate(c, contract);
        const plan = c.get("apiPlan") ?? "free";
        if (plan === "free" && contract.tier === "paid") throw new DataError("This endpoint requires a paid plan", 403, "PAID_PLAN_REQUIRED");

        if (query.symbol !== undefined && (!validCompanyPath(query.symbol) || c.req.queries("symbol")?.length !== 1)) throw new DataError("symbol must be a single company URL path", 400, "INVALID_QUERY");
        const symbols = query.symbol ? [query.symbol] : [];
        requireCompanyAccess(plan, symbols);
        if (contract.status === "unavailable") throw new DataError(contract.limitation);
        const provider = providerFactory(c.env ?? {});
        const result = await provider.execute(contract.resource, query);
        for (const [name, value] of Object.entries(result.headers ?? {})) if (name.toLowerCase() !== "x-data-source") c.header(name, value);
        c.header("Cache-Control", "private, max-age=900");
        c.header("X-Data-Coverage", "partial");
        return c.json(result.body as Record<string, unknown>);
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
