import axios, { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { BASE_URL, COOKIE } from "@stock-market/common/env";
import { sendReq } from "./sendReq.js";
import { sourceCacheKey, sourceCacheTtl, type SourceCache, type CacheResult } from "./cache.js";

export type SourceOptions = { baseUrl?: string; cookie?: string; requestId?: string; cache?: SourceCache; cacheEnabled?: boolean };

export class SourceError extends Error {
  constructor(message: string, public code: string, public status: 404 | 502 | 503 = 502) { super(message); }
}

export type SourceText = { text: string; finalUrl?: string };

export function validateSourceText(url: URL, text: string) {
  if (/<title>[^<]*(?:login|register|sign in)/i.test(text) || /form[^>]+action=["'][^"']*login/i.test(text)) {
    throw new SourceError("The data source requires authentication.", "SOURCE_AUTH_REQUIRED");
  }
  if (/\/schedules\/|\/investors\//.test(url.pathname)) {
    let rows: unknown;
    try { rows = JSON.parse(text); } catch { throw new SourceError("Source detail rows could not be parsed", "UPSTREAM_SCHEMA_CHANGED"); }
    if (!rows || typeof rows !== "object" || Array.isArray(rows) || Object.values(rows).some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new SourceError("Source detail row format changed", "UPSTREAM_SCHEMA_CHANGED");
    }
  }
  if (url.pathname === "/api/company/search/") {
    try { if (!Array.isArray(JSON.parse(text))) throw new Error(); }
    catch { throw new SourceError("Source search format changed", "UPSTREAM_SCHEMA_CHANGED"); }
  }
  const expectedMarkup = url.pathname.startsWith("/company/actions/") ? /id=["']corporate-actions-/i
    : url.pathname.startsWith("/actions/") || url.pathname.startsWith("/upcoming-results/") ? /id=["']result_list["']/i
    : /\/peers\/?$/.test(url.pathname) ? /<table\b/i : undefined;
  if (expectedMarkup && !expectedMarkup.test(text)) throw new SourceError("Source table format changed", "UPSTREAM_SCHEMA_CHANGED");
}

/** Both fetch and Axios share the same additional-source response cache. */
export async function cachedSourceText(url: URL, source: SourceOptions, load: () => Promise<SourceText>): Promise<CacheResult<SourceText>> {
  const loader = async () => {
    const response = await load();
    validateSourceText(url, response.text);
    return response;
  };
  const ttl = sourceCacheTtl(url.pathname);
  if (!source.cache || source.cacheEnabled === false) return { value: await loader(), hit: false, expiresAt: Date.now() + ttl * 1000, durationMs: 0 };
  return source.cache.remember(await sourceCacheKey("source", url, source.cookie ?? COOKIE), ttl, loader);
}

export async function sourceGet<T = any>(path: string, source: SourceOptions = {}, config: AxiosRequestConfig = {}): Promise<AxiosResponse<T> & { cached: boolean; expiresAt: number }> {
  const url = new URL(path, source.baseUrl ?? BASE_URL);
  const cookie = source.cookie ?? COOKIE;
  const requestConfig = {
    timeout: 15_000,
    // Axios supplies browser cache defaults; workerd only accepts no-store/no-cache.
    fetchOptions: { cache: "no-store" },
    ...config,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...config.headers },
  };
  const requestUrl = new URL(axios.getUri({ ...requestConfig, url: url.href }));
  let response: AxiosResponse<T> | undefined;
  const result = await cachedSourceText(requestUrl, source, async () => {
    response = await sendReq(() => axios.get<T>(url.href, requestConfig), 3, { requestId: source.requestId, upstream: url.origin + url.pathname });
    return { text: typeof response.data === "string" ? response.data : JSON.stringify(response.data) };
  });
  if (response) return { ...response, cached: false, expiresAt: result.expiresAt };
  let data: unknown = result.value.text;
  if (config.responseType !== "text") {
    try { data = JSON.parse(result.value.text); } catch { /* HTML remains text, matching Axios' default transform. */ }
  }
  return {
    data: data as T, status: 200, statusText: "OK", headers: new AxiosHeaders(),
    config: { ...requestConfig, url: url.href, headers: AxiosHeaders.from(requestConfig.headers) },
    cached: result.hit, expiresAt: result.expiresAt,
  };
}
