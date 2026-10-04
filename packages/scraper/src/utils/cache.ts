import { createClient } from "redis";
import { log } from "@stock-market/common/logger";

export const COMPANY_CACHE_TTL = 15 * 60;
export const DETAIL_CACHE_TTL = 6 * 60 * 60;

export type CacheResult<T> = { value: T; hit: boolean; expiresAt: number };
export interface SourceCache {
  remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>, expiresAt?: () => number): Promise<CacheResult<T>>;
  close(): Promise<void>;
}

/** Small storage boundary also used by deterministic cache/concurrency tests. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  acquire(key: string, token: string, leaseMs: number): Promise<boolean>;
  publish(key: string, token: string, value: string, ttlMs: number): Promise<void>;
  release(key: string, token: string): Promise<void>;
  close(): Promise<void>;
}

export class CacheBusyError extends Error {
  constructor() { super("Source data is already being loaded; retry later"); }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cache-aside only: expired entries are misses; all writes finish in the request. */
export class ReadThroughCache implements SourceCache {
  private readonly pending = new Map<string, Promise<CacheResult<unknown>>>();
  private unavailable = false;
  constructor(private readonly store: CacheStore, private readonly prefix: string) {}

  private failure(error: unknown) {
    if (!this.unavailable) {
      const failure = error as { name?: string; code?: string };
      // Redis errors can contain connection credentials. Never log their messages.
      log("warn", "cache.unavailable", { name: failure?.name, code: failure?.code });
    }
    this.unavailable = true;
  }

  private async read<T>(key: string): Promise<CacheResult<T> | undefined> {
    const raw = await this.store.get(key);
    if (raw === null) return;
    try {
      const entry = JSON.parse(raw);
      if (entry?.version === 1 && Number.isFinite(entry.expiresAt) && entry.expiresAt > Date.now() && "value" in entry) {
        return { value: entry.value, expiresAt: entry.expiresAt, hit: true };
      }
    } catch { /* Corrupt/old entries are misses and can be replaced. */ }
  }

  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>, dependencyExpiry?: () => number): Promise<CacheResult<T>> {
    const fullKey = `${this.prefix}:v1:${key}`;
    const pending = this.pending.get(fullKey);
    if (pending) return structuredClone(await pending) as CacheResult<T>;
    const request = this.load(fullKey, ttlSeconds, load, dependencyExpiry);
    this.pending.set(fullKey, request);
    try { return structuredClone(await request); }
    finally { this.pending.delete(fullKey); }
  }

  private async load<T>(key: string, ttlSeconds: number, load: () => Promise<T>, dependencyExpiry?: () => number): Promise<CacheResult<T>> {
    const token = crypto.randomUUID();
    let acquired = false;
    if (!this.unavailable) {
      try {
        const deadline = Date.now() + 30_000;
        while (true) {
          const cached = await this.read<T>(key);
          if (cached) return cached;
          acquired = await this.store.acquire(key, token, 120_000);
          if (acquired) break;
          if (Date.now() >= deadline) throw new CacheBusyError();
          await sleep(100 + Math.random() * 100);
        }
        // A previous loader may have published between our GET and lock acquisition.
        const cached = await this.read<T>(key);
        if (cached) {
          await this.store.release(key, token);
          return cached;
        }
      } catch (error) {
        if (error instanceof CacheBusyError) throw error;
        this.failure(error);
      }
    }
    try {
      // Loader failures propagate and are never stored as successful entries.
      const value = await load();
      const expiresAt = Math.min(Date.now() + ttlSeconds * 1000, dependencyExpiry?.() ?? Infinity);
      if (acquired && !this.unavailable && expiresAt > Date.now()) {
        try { await this.store.publish(key, token, JSON.stringify({ version: 1, value, expiresAt }), expiresAt - Date.now()); }
        catch (error) { this.failure(error); }
      }
      return { value, hit: false, expiresAt };
    } finally {
      if (acquired && !this.unavailable) {
        try { await this.store.release(key, token); }
        catch (error) { this.failure(error); }
      }
    }
  }

  async close() { await this.store.close(); }
}

export function createRedisCache(url: string, prefix = "stock-market:production"): SourceCache {
  // A Worker socket belongs to its request. Lazily connect once, reuse within
  // that request, then destroy it in middleware's finally block.
  const client = createClient({
    url, RESP: 2, disableOfflineQueue: true, disableClientInfo: true,
    maintNotifications: "disabled",
    socket: { connectTimeout: 3_000, reconnectStrategy: false },
    commandOptions: { timeout: 3_000 },
  });
  client.on("error", () => { /* Commands report failures through the cache boundary. */ });
  let connecting: Promise<unknown> | undefined;
  const connection = async () => {
    connecting ??= client.connect();
    await connecting;
    return client;
  };
  const lock = (key: string) => `${key}:lock`;
  const store: CacheStore = {
    get: async (key) => (await connection()).get(key),
    acquire: async (key, token, leaseMs) => (await (await connection()).set(lock(key), token, { NX: true, PX: leaseMs })) === "OK",
    publish: async (key, token, value, ttlMs) => {
      await (await connection()).eval(
        "if redis.call('GET', KEYS[2]) == ARGV[1] then return redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) end return nil",
        { keys: [key, lock(key)], arguments: [token, value, String(Math.max(1, Math.floor(ttlMs)))] },
      );
    },
    release: async (key, token) => {
      await (await connection()).eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", { keys: [lock(key)], arguments: [token] });
    },
    close: async () => { if (client.isOpen) client.destroy(); },
  };
  return new ReadThroughCache(store, prefix);
}

export async function sourceCacheKey(kind: string, url: URL, cookie = "") {
  const normalized = new URL(url);
  if (normalized.pathname.includes("/schedules/") && normalized.searchParams.get("consolidated") === "") normalized.searchParams.delete("consolidated");
  normalized.searchParams.sort();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([normalized.href, cookie])));
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${kind}:${hash}`;
}

export function sourceCacheTtl(path: string) {
  if (/\/schedules\/|\/investors\//.test(path)) return DETAIL_CACHE_TTL;
  if (path === "/api/company/search/") return 24 * 60 * 60;
  if (path.startsWith("/ipo") || path === "/cloud/v2/index/gmp-data") return 5 * 60;
  if (path.startsWith("/actions/") || path.startsWith("/company/actions/") || path.startsWith("/upcoming-results/")) return 30 * 60;
  return COMPANY_CACHE_TTL;
}
