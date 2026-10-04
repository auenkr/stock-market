import type { CacheResult, SourceCache } from "@stock-market/scraper/utils/cache";
import { log } from "@stock-market/common/logger";

// Structural boundary also compiles in Node-only consumers of API types.
export interface EdgeCacheStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
export const EDGE_CACHE_TTL_SECONDS = 60;

/** caches.default is available in Workers, but not in Node/test runtimes. */
export function workerEdgeCache(): EdgeCacheStore | undefined {
  return (globalThis as unknown as { caches?: { default?: EdgeCacheStore } }).caches?.default;
}

/** Internal data only: never stores API responses, credentials or access decisions. */
export class EdgeSourceCache implements SourceCache {
  constructor(
    private readonly shared: SourceCache,
    private readonly edge: EdgeCacheStore,
    private readonly origin: string,
    private readonly prefix: string,
    private readonly waitUntil?: (promise: Promise<void>) => void,
  ) {}

  private async request(key: string): Promise<Request> {
    // Source keys already include source URL/query/cookie identity. Hash again
    // to include the deployment namespace without exposing it in cache URLs.
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([this.prefix, key])));
    const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return new Request(new URL(`/__internal/source-cache/v1/${hash}`, this.origin));
  }

  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>, dependencyExpiry?: () => number): Promise<CacheResult<T>> {
    const request = await this.request(key);
    try {
      const response = await this.edge.match(request);
      if (response?.ok) {
        const entry = await response.json() as { version?: number; value?: T; expiresAt?: number; edgeExpiresAt?: number };
        if (entry.version === 1 && Number.isFinite(entry.expiresAt) && Number.isFinite(entry.edgeExpiresAt)
          && entry.expiresAt! > Date.now() && entry.edgeExpiresAt! > Date.now() && "value" in entry) {
          log("info", "cache.edge.hit");
          return { value: entry.value as T, hit: true, expiresAt: entry.expiresAt! };
        }
      }
      log("info", "cache.edge.miss");
    } catch {
      // Cache API failures must not fail a data request or expose source keys.
      log("warn", "cache.edge.read_failed");
    }

    const sharedStartedAt = performance.now();
    const result = await this.shared.remember(key, ttlSeconds, load, dependencyExpiry);
    log("info", "cache.shared.completed", { hit: result.hit, durationMs: Math.round(performance.now() - sharedStartedAt) });
    const publishedAt = Date.now();
    const maxAge = Math.floor(Math.min(EDGE_CACHE_TTL_SECONDS, ttlSeconds, (result.expiresAt - publishedAt) / 1000));
    if (maxAge > 0 && Number.isFinite(maxAge)) {
      const publish = async () => {
        try {
          const response = Response.json({ version: 1, value: result.value, expiresAt: result.expiresAt, edgeExpiresAt: publishedAt + maxAge * 1000 }, {
            headers: { "Cache-Control": `public, max-age=${maxAge}` },
          });
          await this.edge.put(request, response);
        } catch { log("warn", "cache.edge.write_failed"); }
      };
      // Only the edge write runs in the background. Valkey work has finished
      // before middleware closes its request-scoped socket.
      const write = publish();
      if (this.waitUntil) this.waitUntil(write);
      else await write;
    }
    return result;
  }

  async close() { await this.shared.close(); }
}
