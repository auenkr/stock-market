import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { errorDetails, log } from "@stock-market/common/logger";
import { GetCompanyData } from "@stock-market/scraper/helper/getCompanyData";
import { getCompanyList } from "@stock-market/scraper/helper/getCompanyList";
import { ListUpcommingIpo } from "@stock-market/scraper/helper/getUpcommingIPO";
import { sourceGet, SourceError, type SourceOptions } from "@stock-market/scraper/utils/source";
import { COMPANY_PAGE_SIZE, HomePageData } from "./config.js";
import { createCompatibilityApi, defaultProvider, validCompanyPath, type ProviderFactory, type Bindings } from "./compatibility-api.js";
import { openApi } from "./openapi.js";
import { apiDocsHtml } from "./api-docs.js";
import { DataError } from "./screener-provider.js";

type ApiBindings = Bindings;

type CachedCompanyData = {
  value: Awaited<ReturnType<typeof GetCompanyData>>;
  expiresAt: number;
};

const companyDataCache = new Map<string, CachedCompanyData>();
const cacheTtlMs = 15 * 60 * 1000;
const extractTypes = ["quarterly", "profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding", "peers"] as const;
type ExtractType = (typeof extractTypes)[number];

function requestKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-api-key") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || c.req.header("cf-connecting-ip") || "anonymous";
}

function errorResponse(c: any, message: string, status: 400 | 401 | 404 | 429 | 500) {
  return c.json({
    error: message,
    code: message.toUpperCase().replace(/\s+/g, "_"),
  }, status);
}

function sourceOptions(c: Context<{ Bindings: ApiBindings }>): SourceOptions {
  return { baseUrl: c.env?.BASE_URL, cookie: c.env?.COOKIE, requestId: c.res.headers.get("X-Request-ID") ?? undefined };
}

function upstreamFailure(c: Context, error: unknown) {
  log("error", "api.request.failed", { requestId: c.res.headers.get("X-Request-ID"), method: c.req.method, path: c.req.path, error: errorDetails(error) });
  const upstream = error as { response?: { status?: number }; code?: string };
  const failure = error instanceof DataError ? error
    : error instanceof SourceError ? new DataError(error.message, 502, error.code)
    : upstream.response?.status === 404 ? new DataError("Company or source resource not found", 404, "NOT_FOUND")
    : new DataError("The data source could not be loaded", 502, "UPSTREAM_UNAVAILABLE");
  c.header("Cache-Control", "no-store");
  return c.json({ error: failure.message, code: failure.code }, failure.status);
}

function isExtractType(value: string | undefined): value is ExtractType {
  return Boolean(value && extractTypes.includes(value as ExtractType));
}

async function getCachedCompanyData(endpoint: string, source: SourceOptions) {
  const key = JSON.stringify([source.baseUrl, source.cookie, endpoint]);
  const cached = companyDataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { value: cached.value, hit: true };
  const value = await GetCompanyData(endpoint, { ...source, includeMarketHistory: false });
  companyDataCache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
  if (companyDataCache.size > 100) companyDataCache.delete(companyDataCache.keys().next().value!);
  return { value, hit: false };
}

export function createApp(providerFactory: ProviderFactory = defaultProvider) {
  const app = new Hono<{ Bindings: ApiBindings }>();
  const rateLimit = new Map<string, { count: number; resetAt: number }>();
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    c.header("X-Request-ID", requestId);
    log("info", "api.request.started", { requestId, method: c.req.method, path: c.req.path });
    await next();
    log(c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info", "api.request.completed", {
      requestId, method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - startedAt,
      cache: c.res.headers.get("X-Cache"),
    });
  });
  app.onError((error, c) => {
    log("error", "api.unhandled", { requestId: c.res.headers.get("X-Request-ID"), path: c.req.path, error: errorDetails(error) });
    return errorResponse(c, "Internal Server Error", 500);
  });
  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization", "X-API-Key"], exposeHeaders: ["X-Request-ID", "X-Page", "X-Next-Page", "X-Data-Coverage", "X-Data-Source", "Retry-After"] }));
  app.use("*", async (c, next) => {
    if (!["/v1/", "/v2/", "/api/", "/enterprise/"].some((prefix) => c.req.path.startsWith(prefix))) return next();
    const key = requestKey(c);
    const limit = 60;
    const now = Date.now();
    const current = rateLimit.get(key);
    if (!current && rateLimit.size >= 5000) {
      for (const [id, entry] of rateLimit) if (entry.resetAt <= now) rateLimit.delete(id);
      if (rateLimit.size >= 5000) return errorResponse(c, "Rate limit exceeded", 429);
    }
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + 60_000 }
      : current;

    bucket.count += 1;
    rateLimit.set(key, bucket);
    if (rateLimit.size > 5000) for (const [id, entry] of rateLimit) if (entry.resetAt <= now) rateLimit.delete(id);
    if (Number.isFinite(limit) && limit > 0 && bucket.count > limit) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return errorResponse(c, "Rate limit exceeded", 429);
    }

    await next();
  });

  const api = new Hono<{ Bindings: ApiBindings }>();

  api.get("/list-of-company", async (c) => {
    const pageParam = c.req.query("page") ?? "1";
    const page = Number(pageParam);
    if (!Number.isInteger(page) || page < 1) {
      return errorResponse(c, "page must be a positive integer", 400);
    }

    try {
      const companies = await getCompanyList(COMPANY_PAGE_SIZE, page, sourceOptions(c));
      return c.json({
        data: companies,
        meta: { page, limit: COMPANY_PAGE_SIZE },
        page,
        limit: COMPANY_PAGE_SIZE,
        companies,
      });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  api.get("/list-of-ipo", async (c) => {
    try {
      const ipos = await ListUpcommingIpo(sourceOptions(c));
      return c.json({ data: ipos, ipos });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  api.get("/company-search", async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return errorResponse(c, "q parameter is required", 400);

    try {
      const response = await sourceGet("/api/company/search/", sourceOptions(c), { params: { q: query } });
      return c.json({ data: response.data, results: response.data });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  api.get("/company-data", async (c) => {
    const symbol = c.req.query("symbol")?.trim().toUpperCase();
    if (!symbol) return errorResponse(c, "symbol parameter is required", 400);
    if (!/^[A-Z0-9][A-Z0-9&_-]{0,49}$/.test(symbol)) {
      return errorResponse(c, "symbol must be a single valid stock symbol", 400);
    }
    const endpoint = `/company/${encodeURIComponent(symbol)}/consolidated/`;

    try {
      const result = await getCachedCompanyData(endpoint, sourceOptions(c));
      if (result.hit) c.header("X-Cache", "HIT");
      c.header("Cache-Control", "private, max-age=900");
      return c.json({ data: result.value, companyData: result.value });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  api.get("/extract", async (c) => {
    const endpoint = c.req.query("endpoint")?.trim();
    const type = c.req.query("type");
    if (!endpoint) return errorResponse(c, "endpoint parameter is required", 400);
    if (!validCompanyPath(endpoint)) return errorResponse(c, "endpoint must be a company path", 400);
    if (!isExtractType(type)) return errorResponse(c, `type must be one of: ${extractTypes.join(", ")}`, 400);

    try {
      const result = await getCachedCompanyData(endpoint, sourceOptions(c));
      if (result.hit) c.header("X-Cache", "HIT");
      const data = type === "quarterly" ? result.value.quarterlyResultStatements
        : type === "profit-loss" ? result.value.profitAndLossStatements
        : type === "balance-sheet" ? result.value.balanceSheetStatements
        : type === "cash-flow" ? result.value.cashFlowStatements
        : type === "ratios" ? result.value.ratioStatements
        : type === "shareholding" ? result.value.shareholdingPatternStatements
        : result.value.peerCompanies;
      return c.json({ data, meta: { endpoint, type, cached: result.hit } });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  app.get("/", (c) => c.html(HomePageData));
  app.get("/health", (c) => c.json({ status: "ok", service: "stock-market-api", version: "1.2.0" }));
  app.get("/openapi.json", (c) => c.json(openApi(new URL(c.req.url).origin)));
  app.get("/swagger.json", (c) => c.json(openApi(new URL(c.req.url).origin)));
  app.get("/docs", (c) => c.html(apiDocsHtml));
  app.route("/", createCompatibilityApi(providerFactory));
  app.route("/v1", api);
  app.route("/api", api);
  app.notFound((c) => c.json({ error: "Endpoint not found", code: "NOT_FOUND" }, 404));
  return app;
}

export default createApp();
