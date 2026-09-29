import axios from "axios";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { BASE_URL } from "@stock-market/common/env";
import { GetCompanyData } from "@stock-market/scraper/helper/getCompanyData";
import { getCompanyList } from "@stock-market/scraper/helper/getCompanyList";
import { ListUpcommingIpo } from "@stock-market/scraper/helper/getUpcommingIPO";
import { sendReq } from "@stock-market/scraper/utils/sendReq";
import { COMPANY_PAGE_SIZE, HomePageData } from "./config.js";

type ApiBindings = {
};

type CachedCompanyData = {
  value: Awaited<ReturnType<typeof GetCompanyData>>;
  expiresAt: number;
};

const companyDataCache = new Map<string, CachedCompanyData>();
const rateLimit = new Map<string, { count: number; resetAt: number }>();
const cacheTtlMs = 15 * 60 * 1000;

function requestKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-api-key") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || "anonymous";
}

function errorResponse(c: any, message: string, status: 400 | 401 | 404 | 429 | 500) {
  return c.json({
    error: message,
    code: message.toUpperCase().replace(/\s+/g, "_"),
  }, status);
}

const api = new Hono<{ Bindings: ApiBindings }>();

api.use("*", async (c, next) => {
  const key = requestKey(c);
  const limit = 60;
  const now = Date.now();
  const current = rateLimit.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 60_000 }
    : current;

  bucket.count += 1;
  rateLimit.set(key, bucket);
  if (Number.isFinite(limit) && limit > 0 && bucket.count > limit) {
    c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    return errorResponse(c, "Rate limit exceeded", 429);
  }

  await next();
});

api.get("/list-of-company", async (c) => {
  const pageParam = c.req.query("page") ?? "1";
  const page = Number(pageParam);
  if (!Number.isInteger(page) || page < 1) {
    return errorResponse(c, "page must be a positive integer", 400);
  }

  try {
    const companies = await getCompanyList(COMPANY_PAGE_SIZE, page);
    return c.json({
      data: companies,
      meta: { page, limit: COMPANY_PAGE_SIZE },
      page,
      limit: COMPANY_PAGE_SIZE,
      companies,
    });
  } catch {
    return errorResponse(c, "Could not load company data", 500);
  }
});

api.get("/list-of-ipo", async (c) => {
  try {
    const ipos = await ListUpcommingIpo();
    return c.json({ data: ipos, ipos });
  } catch {
    return errorResponse(c, "Could not load IPO data", 500);
  }
});

api.get("/company-search", async (c) => {
  const query = c.req.query("q")?.trim();
  if (!query) return errorResponse(c, "q parameter is required", 400);

  try {
    const response = await sendReq(() => axios.get(`${BASE_URL}/api/company/search/`, { params: { q: query } }));
    return c.json({ data: response.data, results: response.data });
  } catch {
    return errorResponse(c, "Could not search companies", 500);
  }
});

api.get("/company-data", async (c) => {
  const endpoint = c.req.query("endpoint")?.trim();
  if (!endpoint) return errorResponse(c, "endpoint parameter is required", 400);
  if (!/^\/company\/[a-z0-9_/-]+\/?$/i.test(endpoint)) {
    return errorResponse(c, "endpoint must be a company path", 400);
  }

  const cached = companyDataCache.get(endpoint);
  if (cached && cached.expiresAt > Date.now()) {
    c.header("X-Cache", "HIT");
    return c.json({ data: cached.value, companyData: cached.value });
  }

  try {
    const companyData = await GetCompanyData(endpoint);
    companyDataCache.set(endpoint, { value: companyData, expiresAt: Date.now() + cacheTtlMs });
    c.header("Cache-Control", "private, max-age=900");
    return c.json({ data: companyData, companyData });
  } catch {
    return errorResponse(c, "Could not load company data", 500);
  }
});

const app = new Hono<{ Bindings: ApiBindings }>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization", "X-API-Key"] }));

app.get("/", (c) => c.html(HomePageData));
app.get("/health", (c) => c.json({ status: "ok", service: "stock-market-api", version: "1.0.0" }));
app.get("/openapi.json", (c) => c.json({
  openapi: "3.0.3",
  info: { title: "Stock Market API", version: "1.0.0", description: "Structured Indian market data for applications." },
  servers: [{ url: new URL(c.req.url).origin }],
  security: [{ apiKey: [] }],
  components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key" } } },
  paths: {
    "/v1/list-of-company": { get: { summary: "List companies", parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1 } }] } },
    "/v1/list-of-ipo": { get: { summary: "List upcoming IPOs" } },
    "/v1/company-search": { get: { summary: "Search companies", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }] } },
    "/v1/company-data": { get: { summary: "Get detailed company data", parameters: [{ name: "endpoint", in: "query", required: true, schema: { type: "string" } }] } },
  },
}));
app.route("/v1", api);
app.route("/api", api);

export default app;
