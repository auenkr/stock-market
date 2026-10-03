import axios, { type AxiosRequestConfig } from "axios";
import { BASE_URL, COOKIE } from "@stock-market/common/env";
import { sendReq } from "./sendReq.js";

export type SourceOptions = { baseUrl?: string; cookie?: string; requestId?: string };

export class SourceError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

export async function sourceGet<T = any>(path: string, source: SourceOptions = {}, config: AxiosRequestConfig = {}) {
  const url = new URL(path, source.baseUrl ?? BASE_URL);
  const cookie = source.cookie ?? COOKIE;
  const response = await sendReq(() => axios.get<T>(url.href, {
    timeout: 15_000,
    // Axios supplies browser cache defaults; workerd only accepts no-store/no-cache.
    fetchOptions: { cache: "no-store" },
    ...config,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...config.headers },
  }), 3, { requestId: source.requestId, upstream: url.origin + url.pathname });
  if (typeof response.data === "string" && (/<title>[^<]*(?:login|register|sign in)/i.test(response.data) || /form[^>]+action=["'][^"']*login/i.test(response.data))) {
    throw new SourceError("The data source requires authentication.", "SOURCE_AUTH_REQUIRED");
  }
  return response;
}
