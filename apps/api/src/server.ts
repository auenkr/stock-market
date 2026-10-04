import { legacyEndpointTiers } from "./endpoint-catalog.js";
import { hasDetailedData } from "@stock-market/db/plans";
import type { AccessVariables } from "./endpoint-access.js";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { errorDetails, log } from "@stock-market/common/logger";
import { GetCompanyData } from "@stock-market/scraper/helper/getCompanyData";
import { getCompanyListPage } from "@stock-market/scraper/helper/getCompanyList";
import { ListUpcommingIpo } from "@stock-market/scraper/helper/getUpcommingIPO";
import { sourceGet, SourceError, type SourceOptions } from "@stock-market/scraper/utils/source";
import { COMPANY_PAGE_SIZE, HomePageData } from "./config.js";
import { createCompatibilityApi, defaultProvider, validCompanyPath, type ProviderFactory, type Bindings } from "./compatibility-api.js";
import { openApi } from "./openapi.js";
import { agentOpenApi, agentPluginManifest, agentTools } from "@stock-market/agent-tools";
import { apiDocsHtml } from "./api-docs.js";
import { DataError } from "./screener-provider.js";
import { authorizeAccountRequest, type AuthorizeRequest, type AccountAccessBindings } from "@stock-market/db/account-access";
import { CacheBusyError, COMPANY_CACHE_TTL, createRedisCache, sourceCacheKey, type CacheStats, type SourceCache } from "@stock-market/scraper/utils/cache";
import { BASE_URL, COOKIE } from "@stock-market/common/env";

type ApiBindings = Bindings & AccountAccessBindings;

/** Per-request cost breakdown, published on the completion log and as response headers. */
type RequestTimings = { startedAt: number; authMs?: number; authStatus?: string; cache?: CacheStats; handlerMs?: number };
const requestTimings = new WeakMap<object, RequestTimings>();
const since = (startedAt: number) => Math.round((performance.now() - startedAt) * 10) / 10;

const extractTypes = ["quarterly", "profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding", "peers"] as const;
type ExtractType = (typeof extractTypes)[number];

function requestKey(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  return c.req.header("x-api-key")?.trim() || c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

function errorResponse(c: any, message: string, status: 400 | 401 | 404 | 429 | 500 | 503) {
  return c.json({
    error: message,
    code: message.toUpperCase().replace(/\s+/g, "_"),
  }, status);
}

function sourceOptions(c: Context<{ Bindings: ApiBindings; Variables: AccessVariables }>): SourceOptions {
  return { baseUrl: c.env?.BASE_URL, cookie: c.env?.COOKIE, cache: c.get("sourceCache"), cacheEnabled: c.env?.CACHE_ENABLED?.trim().toLowerCase() !== "false", requestId: c.res.headers.get("X-Request-ID") ?? undefined };
}

function upstreamFailure(c: Context, error: unknown) {
  log("error", "api.request.failed", { requestId: c.res.headers.get("X-Request-ID"), method: c.req.method, path: c.req.path, error: errorDetails(error) });
  const upstream = error as { response?: { status?: number }; code?: string };
  const failure = error instanceof DataError ? error
    : error instanceof CacheBusyError ? new DataError(error.message, 503, "SOURCE_BUSY")
    : error instanceof SourceError ? new DataError(error.message, error.status, error.code)
    : upstream.response?.status === 404 ? new DataError("Company or source resource not found", 404, "NOT_FOUND")
    : new DataError("The data source could not be loaded", 502, "UPSTREAM_UNAVAILABLE");
  c.header("Cache-Control", "no-store");
  return c.json({ error: failure.message, code: failure.code }, failure.status);
}

function isExtractType(value: string | undefined): value is ExtractType {
  return Boolean(value && extractTypes.includes(value as ExtractType));
}

async function getCachedCompanyData(endpoint: string, source: SourceOptions) {
  if (source.cache && source.cacheEnabled !== false) {
    let snapshotExpiry = Infinity;
    return source.cache.remember(await sourceCacheKey("legacy-company", new URL(endpoint.endsWith("/") ? endpoint : `${endpoint}/`, source.baseUrl ?? BASE_URL), source.cookie ?? COOKIE), COMPANY_CACHE_TTL,
      () => GetCompanyData(endpoint, { ...source, includeMarketHistory: false, onSnapshot: (expiresAt) => { snapshotExpiry = expiresAt; } }),
      () => snapshotExpiry);
  }
  return { value: await GetCompanyData(endpoint, { ...source, includeMarketHistory: false }), hit: false };
}

export type CacheFactory = (url: string, prefix: string) => SourceCache;
export function createApp(providerFactory: ProviderFactory = defaultProvider, authorize: AuthorizeRequest = authorizeAccountRequest, cacheFactory: CacheFactory = createRedisCache) {
  const app = new Hono<{ Bindings: ApiBindings; Variables: AccessVariables }>();
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    const timings: RequestTimings = { startedAt };
    requestTimings.set(c, timings);
    c.header("X-Request-ID", requestId);
    log("info", "api.request.started", { requestId, method: c.req.method, path: c.req.path });
    await next();
    // authMs + handlerMs + cache time is the whole in-Worker budget; anything the
    // client sees beyond this is network and cold-start.
    const durationMs = since(startedAt);
    log(c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info", "api.request.completed", {
      requestId, method: c.req.method, path: c.req.path, status: c.res.status, durationMs,
      authMs: timings.authMs, authStatus: timings.authStatus, handlerMs: timings.handlerMs,
      cache: c.res.headers.get("X-Cache"),
      cacheStats: timings.cache && { hits: timings.cache.hits, misses: timings.cache.misses, busy: timings.cache.busy, failures: timings.cache.failures, operations: timings.cache.operations, durationMs: timings.cache.durationMs, connectMs: timings.cache.connectMs },
    });
  });
  app.onError((error, c) => {
    log("error", "api.unhandled", { requestId: c.res.headers.get("X-Request-ID"), path: c.req.path, error: errorDetails(error) });
    return errorResponse(c, "Internal Server Error", 500);
  });
  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization", "X-API-Key"], exposeHeaders: ["X-Request-ID", "X-Page", "X-Next-Page", "X-Data-Coverage", "Retry-After", "X-Auth-Time", "X-Cache-Time", "X-Cache-Connect-Time", "X-Source-Time", "X-Total-Time"] }));
  app.use("*", async (c, next) => {
    if (!["/v1/", "/v2/", "/api/"].some((prefix) => c.req.path.startsWith(prefix))) return next();
    const timings = requestTimings.get(c);
    const authStartedAt = performance.now();
    const access = await authorize(requestKey(c), c.env ?? {});
    if (timings) { timings.authMs = since(authStartedAt); timings.authStatus = access.status; }
    log(timings?.authMs && timings.authMs > 1_000 ? "warn" : "info", "api.auth.completed", {
      requestId: c.res.headers.get("X-Request-ID"), path: c.req.path, status: access.status,
      plan: access.status === "allowed" ? access.plan : undefined, durationMs: timings?.authMs,
    });
    c.header("Cache-Control", "no-store");
    if (access.status === "unauthorized") return errorResponse(c, "Invalid or expired API key", 401);
    if (access.status === "unavailable") return errorResponse(c, "Account usage service unavailable", 503);
    if (access.status === "limited") {
      c.header("Retry-After", String(access.retryAfter));
      return errorResponse(c, "Rate limit exceeded", 429);
    }

    c.set("apiPlan", access.plan ?? "free");
    const legacyResource = c.req.path.match(/^\/(?:v1|api)\/([^/]+)$/)?.[1];
    if (!hasDetailedData(access.plan ?? "free") && legacyResource && legacyEndpointTiers[legacyResource as keyof typeof legacyEndpointTiers] === "paid") {
      return c.json({ error: "This endpoint requires Personal or Professional", code: "PAID_PLAN_REQUIRED", docs: "/v1/coverage" }, 403);
    }
    const cache = c.env?.CACHE_ENABLED?.trim().toLowerCase() !== "false" && c.env?.VALKEY_URL?.trim()
      ? cacheFactory(c.env.VALKEY_URL.trim(), c.env.VALKEY_CACHE_PREFIX?.trim() || `stock-market:${c.env.ENVIRONMENT ?? "production"}`)
      : undefined;
    c.set("sourceCache", cache);
    const handlerStartedAt = performance.now();
    try { await next(); }
    finally {
      if (timings) timings.handlerMs = since(handlerStartedAt);
      if (cache) {
        const stats = cache.stats();
        if (timings) timings.cache = stats;
        log(stats.connectMs > 500 ? "warn" : "info", "api.cache.completed", {
          requestId: c.res.headers.get("X-Request-ID"), path: c.req.path, ...stats,
        });
        c.header("X-Cache-Time", String(stats.durationMs));
        if (stats.connectMs) c.header("X-Cache-Connect-Time", String(stats.connectMs));
        await cache.close();
      }
      c.header("X-Auth-Time", String(timings?.authMs ?? 0));
      c.header("X-Total-Time", String(Math.round(performance.now() - (timings?.startedAt ?? performance.now()))));
      c.header("Cache-Control", "no-store");
    }
  });

  const api = new Hono<{ Bindings: ApiBindings; Variables: AccessVariables }>();

  api.get("/list-of-company", async (c) => {
    const pageParam = c.req.query("page") ?? "1";
    const page = Number(pageParam);
    if (!Number.isSafeInteger(page) || page < 1) {
      return errorResponse(c, "page must be a positive integer", 400);
    }

    try {
      const result = await getCompanyListPage(COMPANY_PAGE_SIZE, page, sourceOptions(c));
      const companies = result.companies.map(({ skip, url, ...company }) => ({ ...company, symbol: url }));
      const pagination = {
        currentPage: page,
        limit: COMPANY_PAGE_SIZE,
        count: companies.length,
        isNextPageAvailable: result.nextPage !== null,
        nextPage: result.nextPage,
        previousPage: page > 1 ? page - 1 : null,
      };
      return c.json({
        meta: pagination,
        data: companies,
      });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  api.get("/list-of-ipo", async (c) => {
    try {
      const ipos = (await ListUpcommingIpo(sourceOptions(c))).map(({ url, ...ipo }) => ({ ...ipo, symbol: url }));
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
      const results = response.data.map(({ url, ...company }: { url: string; [key: string]: unknown }) => ({ ...company, symbol: url }));
      return c.json({ data: results, results });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  api.get("/company-data", async (c) => {
    const symbol = c.req.query("symbol")?.trim();
    if (!symbol) return errorResponse(c, "symbol parameter is required", 400);
    if (!validCompanyPath(symbol) || c.req.queries("symbol")?.length !== 1 || Object.keys(c.req.query()).some((name) => name !== "symbol")) {
      return errorResponse(c, "symbol must be a single company path", 400);
    }

    try {
      const result = await getCachedCompanyData(symbol, sourceOptions(c));
      if (result.hit) c.header("X-Cache", "HIT");
      c.header("Cache-Control", "private, max-age=900");
      const { url, ...company } = result.value;
      const data = { ...company, symbol, website: url };
      return c.json({ data, companyData: data });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  api.get("/extract", async (c) => {
    const symbol = c.req.query("symbol")?.trim();
    const type = c.req.query("type");
    if (!symbol) return errorResponse(c, "symbol parameter is required", 400);
    if (!validCompanyPath(symbol) || c.req.queries("symbol")?.length !== 1 || Object.keys(c.req.query()).some((name) => !["symbol", "type"].includes(name))) return errorResponse(c, "symbol must be a single company path", 400);
    if (!isExtractType(type)) return errorResponse(c, `type must be one of: ${extractTypes.join(", ")}`, 400);

    try {
      const result = await getCachedCompanyData(symbol, sourceOptions(c));
      if (result.hit) c.header("X-Cache", "HIT");
      const data = type === "quarterly" ? result.value.quarterlyResultStatements
        : type === "profit-loss" ? result.value.profitAndLossStatements
        : type === "balance-sheet" ? result.value.balanceSheetStatements
        : type === "cash-flow" ? result.value.cashFlowStatements
        : type === "ratios" ? result.value.ratioStatements
        : type === "shareholding" ? result.value.shareholdingPatternStatements
        : result.value.peerCompanies;
      return c.json({ data, meta: { symbol, type, cached: result.hit } });
    } catch (error) {
      return upstreamFailure(c, error);
    }
  });

  app.get("/", (c) => c.html(HomePageData(c.env?.ENVIRONMENT ?? (typeof process === "undefined" ? undefined : process.env.ENVIRONMENT))));
  app.get("/health", (c) => c.json({ status: "ok", service: "stock-market-api", version: "1.2.0" }));
  const documentedSpec = (c: Context<{ Bindings: ApiBindings; Variables: AccessVariables }>) => openApi(new URL(c.req.url).origin, c.env?.ENVIRONMENT ?? (typeof process === "undefined" ? undefined : process.env.ENVIRONMENT));
  app.get("/openapi.json", (c) => c.json(documentedSpec(c)));
  app.get("/swagger.json", (c) => c.json(documentedSpec(c)));
  app.get("/plugin/openapi.json", (c) => {
    const spec = documentedSpec(c) as unknown as Parameters<typeof agentOpenApi>[0];
    return c.json(agentOpenApi(spec, { title: "Ledgerline Stock Market API for AI agents", version: "1.2.0", description: `${spec.info?.description ?? "Indian company financials for AI agents."} Discovery-first: search or list companies, then pass the returned symbol to company endpoints. No internal or market-history endpoints are exposed.` }));
  });
  app.get("/.well-known/ai-plugin.json", (c) => {
    const origin = new URL(c.req.url).origin;
    const spec = documentedSpec(c) as unknown as Parameters<typeof agentOpenApi>[0];
    return c.json(agentPluginManifest(origin, agentTools(spec)));
  });
  app.get("/docs", (c) => c.html(apiDocsHtml));
  app.route("/", createCompatibilityApi(providerFactory));
  app.route("/v1", api);
  app.route("/api", api);
  app.notFound((c) => c.json({ error: "Endpoint not found", code: "NOT_FOUND" }, 404));
  return app;
}

export default createApp();
