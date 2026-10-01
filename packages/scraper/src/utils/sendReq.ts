import type { AxiosResponse } from "axios";
import { errorDetails, log } from "@stock-market/common/logger";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

type RequestError = {
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
  };
};

function getRetryAfterMs(error: unknown): number | undefined {
  const retryAfter = (error as RequestError).response?.headers?.["retry-after"];
  const value = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;

  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - Date.now());
}

function isRetryableError(error: unknown): boolean {
  const status = (error as RequestError).response?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export async function sendReq<T>(
  request: () => Promise<AxiosResponse<T>>,
  maxRetries = DEFAULT_MAX_RETRIES,
  context: { requestId?: string; upstream?: string } = {},
): Promise<AxiosResponse<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) {
        log("error", "upstream.request.failed", { ...context, attempt: attempt + 1, error: errorDetails(error) });
        throw error;
      }

      const delayMs = Math.min(getRetryAfterMs(error) ?? DEFAULT_RETRY_DELAY_MS * 2 ** attempt, 30_000);
      log("warn", "upstream.request.retry", { ...context, attempt: attempt + 1, delayMs, error: errorDetails(error) });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
