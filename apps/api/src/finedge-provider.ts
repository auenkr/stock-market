import { DataError, type DataProvider, type DataQuery, type DataResult } from "./screener-provider.js";
import { finedgeOnlyResources, finedgeFallbackResources } from "./finedge-resources.js";
import { responseSchemas } from "./reference-schemas.js";
import type { Schema } from "./endpoint-catalog.js";

const symbolResources = new Set(["segment-revenue", "notes", "shareholdings/declaration", "shareholdings/beneficial-owners", "financials", "ratios", "financial-metrics", "basic-financials"]);
const envelopes: Record<string, string> = {
  "segment-revenue": "segment_revenues", notes: "notes", "shareholdings/declaration": "declarations",
  "shareholdings/beneficial-owners": "beneficial_owners", financials: "financials", ratios: "ratios", "basic-financials": "basic_financials",
};

function schemaError(): never { throw new DataError("FinEdge response format changed", 502, "UPSTREAM_SCHEMA_CHANGED"); }
function normalize(value: unknown, schema: Schema): unknown {
  if (value === null && schema.nullable) return null;
  if (schema.type === "array") {
    if (!Array.isArray(value)) return schemaError();
    return value.map(item => normalize(item, schema.items!));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return schemaError();
    const result: Record<string, unknown> = { ...value };
    for (const name of schema.required ?? []) if (!(name in result)) {
      if (schema.properties?.[name]?.nullable) result[name] = null;
      else return schemaError();
    }
    for (const [name, field] of Object.entries(schema.properties ?? {})) if (name in result) result[name] = normalize(result[name], field);
    if (typeof schema.additionalProperties === "object") for (const name of Object.keys(result)) {
      if (!schema.properties?.[name]) result[name] = normalize(result[name], schema.additionalProperties);
    }
    return result;
  }
  if (schema.type && typeof value !== schema.type) return schemaError();
  return value;
}

export class FinEdgeProvider implements DataProvider {
  private readonly fetcher: typeof fetch;
  private readonly cache = new Map<string, { result: DataResult; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<DataResult>>();
  private windowStart = Date.now();
  private requests = 0;
  constructor(private readonly options: { apiKey: string; baseUrl?: string; fetcher?: typeof fetch }) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  async execute(resource: string, query: DataQuery): Promise<DataResult> {
    if (!finedgeFallbackResources.has(resource)) throw new DataError("FinEdge Basic does not supply this dataset");
    if (query.page && query.page !== "1") throw new DataError("FinEdge does not support this page cursor");
    if (symbolResources.has(resource) && !/^[a-z0-9][a-z0-9&_-]{0,49}$/i.test(query.symbol ?? "")) throw new DataError("Invalid stock symbol", 400, "INVALID_QUERY");
    const path = `/api/v1/${resource}${symbolResources.has(resource) ? `/${encodeURIComponent(query.symbol!)}` : ""}`;
    const params = new URLSearchParams(Object.entries(query).filter(([name]) => !["symbols", "page", "corp_action", ...(symbolResources.has(resource) ? ["symbol"] : [])].includes(name)).sort());
    const key = `${path}?${params}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const pending = this.pending.get(key); if (pending) return pending;
    if (this.pending.size >= 8) throw new DataError("FinEdge source capacity reached; retry later", 503, "SOURCE_BUSY");
    if (Date.now() - this.windowStart >= 60_000) { this.windowStart = Date.now(); this.requests = 0; }
    if (this.requests >= 300) throw new DataError("FinEdge request limit reached; retry later", 503, "SOURCE_RATE_LIMITED");
    this.requests++;
    const request = this.load(path, params, resource).then(result => {
      this.cache.delete(key); this.cache.set(key, { result, expiresAt: Date.now() + 900_000 });
      if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
      return result;
    });
    this.pending.set(key, request);
    try { return await request; } finally { this.pending.delete(key); }
  }

  private async load(path: string, params: URLSearchParams, resource: string): Promise<DataResult> {
    const url = new URL(path, this.options.baseUrl ?? "https://data.finedgeapi.com");
    params.set("token", this.options.apiKey); url.search = params.toString();
    let response: Response; let text: string;
    try {
      response = await this.fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000), redirect: "error" });
      text = await response.text();
    } catch {
      // Never propagate fetch errors or upstream bodies: URLs contain the source token.
      throw new DataError("FinEdge could not be reached", 502, "UPSTREAM_UNAVAILABLE");
    }
    if (/ER0*17\b|ER0*12\b/i.test(text) || [402, 403].includes(response.status)) throw new DataError("This dataset or symbol is not available under the FinEdge subscription", 501, "SOURCE_PLAN_RESTRICTED");
    if (response.status === 401) throw new DataError("FinEdge requires a valid API key", 502, "SOURCE_AUTH_REQUIRED");
    if (response.status === 429) throw new DataError("FinEdge request limit reached; retry later", 503, "SOURCE_RATE_LIMITED");
    if (response.status === 404) throw new DataError("FinEdge resource not found", 404, "NOT_FOUND");
    if (!response.ok) throw new DataError("FinEdge returned an upstream error", 502, "UPSTREAM_UNAVAILABLE");
    let body: any;
    try { body = JSON.parse(text); } catch { throw new DataError("FinEdge response format changed", 502, "UPSTREAM_SCHEMA_CHANGED"); }
    if (resource === "shareholdings/declaration" && body && Array.isArray(body.declaration)) {
      const { declaration, ...rest } = body; body = { ...rest, declarations: declaration };
    }
    if (resource === "basic-financials" && body && Array.isArray(body.ratios)) {
      const { ratios, ...rest } = body; body = { ...rest, basic_financials: ratios };
    }
    const envelope = envelopes[resource];
    const valid = envelope ? body && !Array.isArray(body) && Array.isArray(body[envelope])
      : resource === "financial-metrics" ? body && !Array.isArray(body) && body.financial_metrics && typeof body.financial_metrics === "object" && !Array.isArray(body.financial_metrics)
      : Array.isArray(body);
    if (!valid) throw new DataError("FinEdge response format changed", 502, "UPSTREAM_SCHEMA_CHANGED");
    body = normalize(body, responseSchemas[resource.replaceAll("/", "_").replaceAll("-", "_")]!);
    return { body, headers: { "X-Data-Source": "finedge", "X-Data-Coverage": "partial" } };
  }
}

/** Keep existing source mappings; use FinEdge for unavailable datasets/variants. */
export class FallbackProvider implements DataProvider {
  constructor(private readonly primary: DataProvider, private readonly finedge?: DataProvider) {}
  async execute(resource: string, query: DataQuery): Promise<DataResult> {
    if (finedgeOnlyResources.has(resource)) {
      if (!this.finedge) throw new DataError("Configure FINEDGE_API_KEY to access this dataset");
      return this.finedge.execute(resource, query);
    }
    try { return await this.primary.execute(resource, query); }
    catch (error) {
      if (!(error instanceof DataError) || error.status !== 501 || !this.finedge || !finedgeFallbackResources.has(resource)) throw error;
      return this.finedge.execute(resource, query);
    }
  }
}
