import type { AxiosResponse } from "axios";

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
): Promise<AxiosResponse<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) throw error;

      const delayMs = getRetryAfterMs(error) ?? DEFAULT_RETRY_DELAY_MS * 2 ** attempt;
      await Bun.sleep(delayMs);
    }
  }
}
