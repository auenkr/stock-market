import { createClient } from "redis";
import { errorDetails, log } from "@stock-market/common/logger";

export const COMPANY_CACHE_TTL = 15 * 60;
export const DETAIL_CACHE_TTL = 6 * 60 * 60;

const since = (startedAt: number) => Math.round((performance.now() - startedAt) * 10) / 10;

export type CacheResult<T> = { value: T; hit: boolean; expiresAt: number; durationMs: number };
export type CacheStats = {
  operations: number; hits: number; misses: number; busy: number; failures: number;
  durationMs: number; connectMs: number;
};
export interface SourceCache {
  remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>, expiresAt?: () => number): Promise<CacheResult<T>>;
  /** Per-request counters, logged once when the request finishes. */
  stats(): CacheStats;
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
  private readonly counters: CacheStats = { operations: 0, hits: 0, misses: 0, busy: 0, failures: 0, durationMs: 0, connectMs: 0 };
  constructor(private readonly store: CacheStore, private readonly prefix: string, private readonly connectMs: () => number = () => 0) {}

  stats(): CacheStats { return { ...this.counters, connectMs: this.connectMs() }; }

  private record(outcome: "hit" | "miss" | "coalesced" | "busy" | "failure", key: string, startedAt: number, fields: Record<string, unknown>) {
    const durationMs = since(startedAt);
    this.counters.operations += 1;
    this.counters.durationMs = Math.round((this.counters.durationMs + durationMs) * 10) / 10;
    if (outcome === "hit") this.counters.hits += 1;
    else if (outcome === "miss") this.counters.misses += 1;
    else if (outcome === "busy") this.counters.busy += 1;
    else if (outcome === "failure") this.counters.failures += 1;
    log(outcome === "busy" || outcome === "failure" ? "warn" : "info", `cache.${outcome}`, { key, durationMs, ...fields });
    return durationMs;
  }

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
        return { value: entry.value, expiresAt: entry.expiresAt, hit: true, durationMs: 0 };
      }
    } catch { /* Corrupt/old entries are misses and can be replaced. */ }
  }

  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>, dependencyExpiry?: () => number): Promise<CacheResult<T>> {
    const fullKey = `${this.prefix}:v1:${key}`;
    const startedAt = performance.now();
    const pending = this.pending.get(fullKey);
    if (pending) {
      const result = structuredClone(await pending) as CacheResult<T>;
      this.record("coalesced", key, startedAt, { coalescedInto: result.hit ? "hit" : "miss" });
      return result;
    }
    const request = this.load(fullKey, ttlSeconds, load, dependencyExpiry);
    this.pending.set(fullKey, request);
    try { return structuredClone(await request); }
    finally { this.pending.delete(fullKey); }
  }

  private async load<T>(key: string, ttlSeconds: number, load: () => Promise<T>, dependencyExpiry?: () => number): Promise<CacheResult<T>> {
    const startedAt = performance.now();
    const token = crypto.randomUUID();
    let acquired = false;
    if (!this.unavailable) {
      try {
        const deadline = Date.now() + 30_000;
        while (true) {
          const cached = await this.read<T>(key);
          if (cached) return { ...cached, durationMs: this.record("hit", key, startedAt, { expiresAt: cached.expiresAt }) };
          acquired = await this.store.acquire(key, token, 120_000);
          if (acquired) break;
          if (Date.now() >= deadline) throw new CacheBusyError();
          await sleep(100 + Math.random() * 100);
        }
        // A previous loader may have published between our GET and lock acquisition.
        const cached = await this.read<T>(key);
        if (cached) {
          await this.store.release(key, token);
          return { ...cached, durationMs: this.record("hit", key, startedAt, { expiresAt: cached.expiresAt, afterLock: true }) };
        }
      } catch (error) {
        if (error instanceof CacheBusyError) {
          this.record("busy", key, startedAt, { error: errorDetails(error), ttlSeconds });
          throw error;
        }
        this.failure(error);
      }
    }
    try {
      // Loader failures propagate and are never stored as successful entries.
      let value: T;
      const loaderStartedAt = performance.now();
      try { value = await load(); }
      catch (error) {
        this.record("failure", key, startedAt, { error: errorDetails(error), loaderMs: since(loaderStartedAt) });
        throw error;
      }
      const loaderMs = since(loaderStartedAt);
      const expiresAt = Math.min(Date.now() + ttlSeconds * 1000, dependencyExpiry?.() ?? Infinity);
      if (acquired && !this.unavailable && expiresAt > Date.now()) {
        try { await this.store.publish(key, token, JSON.stringify({ version: 1, value, expiresAt }), expiresAt - Date.now()); }
        catch (error) { this.failure(error); }
      }
      const durationMs = this.record("miss", key, startedAt, { loaderMs, ttlSeconds, locked: acquired });
      return { value, hit: false, expiresAt, durationMs };
    } finally {
      if (acquired && !this.unavailable) {
        try { await this.store.release(key, token); }
        catch (error) { this.failure(error); }
      }
    }
  }

  async close() { await this.store.close(); }
}

/** Host and port only; a Redis URL carries the password in its userinfo field. */
function hostOf(url: string) {
  try { const parsed = new URL(url); return `${parsed.hostname}:${parsed.port || "6379"}`; }
  catch { return "unknown"; }
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
  let connectMs = 0;
  const connection = async () => {
    if (!connecting) {
      const startedAt = performance.now();
      log("info", "cache.connect.started", { host: hostOf(url) });
      connecting = client.connect();
      connecting = connecting.then(
        (client) => { connectMs = since(startedAt); log("info", "cache.connect.completed", { host: hostOf(url), durationMs: connectMs }); return client; },
        (error) => { connectMs = since(startedAt); log("warn", "cache.connect.failed", { host: hostOf(url), durationMs: connectMs, error: errorDetails(error) }); throw error; },
      );
    }
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
  return new ReadThroughCache(store, prefix, () => connectMs);
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
