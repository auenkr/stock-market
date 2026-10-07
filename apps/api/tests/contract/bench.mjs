/**
 * Latency benchmark for the API contract implementations.
 *
 * Boots the TypeScript app (or targets an external base URL such as the Rust
 * service) against shared disposable-style backends, seeds a professional key,
 * then measures steady-state latency for auth-only, cached-search, cold and
 * warm company payloads at several concurrencies.
 *
 * Usage (from repo root):
 *   BENCH_DATABASE_URL=postgresql://.../db BENCH_VALKEY_URL=redis://127.0.0.1:56380 \
 *   BENCH_SOURCE_URL=http://127.0.0.1:59410 BENCH_PREFIX=stock-market:bench-ts \
 *   node apps/api/tests/contract/bench.mjs [--base-url http://127.0.0.1:3101] [--label rust]
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import axios from 'axios';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') ? '1' : all[i + 1]] : []).filter(Boolean));
const LABEL = args.label ?? (args['base-url'] ? 'external' : 'typescript');
const DATABASE_URL = process.env.BENCH_DATABASE_URL;
const VALKEY_URL = process.env.BENCH_VALKEY_URL;
const SOURCE_URL = process.env.BENCH_SOURCE_URL;
const PREFIX = process.env.BENCH_PREFIX ?? `stock-market:bench-${Date.now()}`;
if (!DATABASE_URL || !VALKEY_URL || !SOURCE_URL) throw new Error('Set BENCH_DATABASE_URL, BENCH_VALKEY_URL and BENCH_SOURCE_URL');

const sql = postgres(DATABASE_URL, { max: 4 });
let servers = [];
async function listen(handler) {
  const { createServer } = await import('node:http');
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let baseUrl = args['base-url'];
if (!baseUrl) {
  // Boot the real TypeScript app against the same backends.
  const adapter = axios.defaults.adapter;
  const realAdapter = axios.getAdapter(adapter);
  axios.defaults.adapter = (config) => {
    if (config.url?.startsWith('https://www.moneycontrol.com/')) return Promise.resolve({ data: [], status: 200, statusText: 'OK', headers: {}, config });
    return realAdapter(config);
  };
  const { createApp } = await import('../../src/server.js');
  const app = createApp();
  const env = { DB_CONNECTION_URL: DATABASE_URL, BASE_URL: SOURCE_URL, COOKIE: '', ENVIRONMENT: 'dev', VALKEY_URL, VALKEY_CACHE_PREFIX: PREFIX, CACHE_ENABLED: 'true' };
  baseUrl = await listen(async (req, res) => {
    try {
      const response = await app.fetch(new Request(new URL(req.url, 'http://127.0.0.1'), { method: req.method, headers: req.headers }), env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end(); }
  });
}

// Seed a fresh professional key (fresh quota window).
const userId = randomUUID();
await sql`INSERT INTO "user" (id, name, email, profile_completed, api_plan, plan_expires_at, created_at, updated_at) VALUES (${userId}, 'Bench', ${`${userId}@bench.invalid`}, true, 'professional', now() + interval '1 month', now(), now())`;
const secret = `sm_live_${randomBytes(24).toString('hex')}`;
await sql`INSERT INTO api_key (id, user_id, name, key_hash) VALUES (${randomUUID()}, ${userId}, 'Bench', ${createHash('sha256').update(secret).digest('hex')})`;
await sql`INSERT INTO usage_policy (id, request_limit) VALUES ('default', 10000), ('personal', 10000), ('professional', 10000) ON CONFLICT (id) DO UPDATE SET request_limit = 10000`;

async function get(path) {
  const start = performance.now();
  const res = await fetch(baseUrl + path, { headers: { 'X-API-Key': secret }, signal: AbortSignal.timeout(60000) });
  await res.arrayBuffer();
  if (res.status !== 200) throw new Error(`${path} -> ${res.status}`);
  return performance.now() - start;
}

async function scenario(name, path, { total, concurrency, warmup = 20 }) {
  for (let i = 0; i < warmup; i++) await get(path);
  const latencies = [];
  const worker = async () => {
    while (latencies.length < total) {
      const t = await get(path);
      latencies.push(t);
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = performance.now() - t0;
  // Overshoot from the while-race is harmless; trim to total.
  latencies.length = Math.min(latencies.length, total);
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
  return { label: LABEL, scenario: name, concurrency, requests: latencies.length, mean: latencies.reduce((a, b) => a + b, 0) / latencies.length, p50: pct(50), p95: pct(95), p99: pct(99), rps: (latencies.length / elapsed) * 1000 };
}

const results = [];
// Auth-only: measures the Postgres authorize path.
results.push(await scenario('auth-only /v1/coverage', '/v1/coverage', { total: 200, concurrency: 1 }));
results.push(await scenario('auth-only /v1/coverage', '/v1/coverage', { total: 400, concurrency: 20 }));
// Cached search: measures the Valkey-hit dataset path.
results.push(await scenario('cached-search', '/v1/company-search?q=acme', { total: 200, concurrency: 1 }));
results.push(await scenario('cached-search', '/v1/company-search?q=acme', { total: 400, concurrency: 20 }));
// Warm company payload (snapshot + schedules cached in Valkey).
results.push(await scenario('warm company-data', '/v1/company-data?symbol=%2Fcompany%2FACME%2F', { total: 100, concurrency: 1 }));
results.push(await scenario('warm company-data', '/v1/company-data?symbol=%2Fcompany%2FACME%2F', { total: 200, concurrency: 20 }));

console.log(`BENCH_RESULT=${JSON.stringify({ label: LABEL, prefix: PREFIX, results })}`);
for (const s of servers) s.close();
await sql.end({ timeout: 1 });
