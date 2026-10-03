import { createServer, type Server, type RequestListener } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import axios from 'axios';
import type { AccountAccessBindings } from '@stock-market/db/account-access';
import { createApp } from '../src/server.js';
import type { Bindings } from '../src/compatibility-api.js';

export async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}` };
}
export async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

export async function bufferedFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const bytes = await response.arrayBuffer();
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function setup() {
  const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
  if (!databaseUrl || !/\/stock_test_\d+_\d+/.test(new URL(databaseUrl).pathname)) throw new Error('Use the disposable test runner');
  const sql = postgres(databaseUrl, { max: 4 });
  const servers: Server[] = [];
  const requests: string[] = [];
  const fixture = readFileSync(new URL('../src/fixtures/company.html', import.meta.url), 'utf8');
  const adapter = axios.defaults.adapter;
  const realAdapter = axios.getAdapter(adapter);
  // Only the optional, hard-coded news service is isolated at its network boundary.
  axios.defaults.adapter = config => {
    if (config.url?.startsWith('https://www.moneycontrol.com/')) return Promise.resolve({ data: [], status: 200, statusText: 'OK', headers: {}, config });
    const target = new URL(config.url!, config.baseURL);
    if (target.hostname !== '127.0.0.1') throw new Error('Unexpected external source request');
    return realAdapter(config);
  };
  try {
    const source = await listen((req, res) => {
      const url = new URL(req.url!, 'http://fixture'); requests.push(url.pathname + url.search);
      res.setHeader('Content-Type', 'text/html');
      if (url.pathname.includes('/MISSING/')) { res.writeHead(404); res.end('Missing'); return; }
      if (url.pathname.includes('/FAIL/')) { res.writeHead(503); res.end('Unavailable'); return; }
      if (url.pathname.includes('/LOGIN/')) { res.end('<title>Login</title><form action="/login/">'); return; }
      if (url.pathname === '/api/company/search/') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ name: 'Acme Ltd', url: '/company/ACME/' }])); return; }
      if (url.pathname.endsWith('/peers')) { res.end(`<table class="data-table"><tbody><tr><td>1</td><td><a href="/company/DEMO/">Demo Ltd</a></td>${'<td>10</td>'.repeat(9)}</tr></tbody></table>`); return; }
      if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return; }
      if (url.pathname.startsWith('/screens/') || url.pathname.startsWith('/market/IN')) {
        res.end(`<table class="data-table"><tbody><tr><td>1</td><td><a href="/company/ACME/">Acme Ltd</a></td>${'<td>10</td>'.repeat(9)}</tr></tbody></table>${url.searchParams.get('page') === '2' ? '' : '<div class="pagination"><a href="?page=2">Next</a></div>'}`); return;
      }
      if (url.pathname.startsWith('/ipo')) { res.end('<table class="data-table"><tbody></tbody></table>'); return; }
      if (url.pathname.startsWith('/actions/') || url.pathname.startsWith('/upcoming-results/')) { res.end('<table id="result_list"><tbody></tbody></table>'); return; }
      if (url.pathname.startsWith('/company/actions/')) { res.end('<section id="corporate-actions-bonus"><table><tbody></tbody></table></section>'); return; }
      // Legacy cache tests use a minimal valid company to avoid deliberate scraper delays.
      res.end((url.pathname.includes('/LEGACY/') || url.pathname.startsWith('/company/id/') || url.pathname.includes('/GVT&D/')) ? fixture.replace(/<section id="(?:profit-loss|quarters|balance-sheet|cash-flow|ratios|quarterly-shp)">[\s\S]*?<\/section>/g, '') : fixture);
    });
    servers.push(source.server);
    await sql`INSERT INTO usage_policy (id, request_limit) VALUES ('default', 10000), ('personal', 10000), ('professional', 10000) ON CONFLICT (id) DO UPDATE SET request_limit = 10000`;
    const bindings = { DB_CONNECTION_URL: databaseUrl, BASE_URL: source.url, COOKIE: 'fixture-session', ENVIRONMENT: 'dev' };
    async function startApi(env: Bindings & AccountAccessBindings = bindings) {
      const app = createApp(); // Real authorization and real provider, no injected decisions.
      const api = await listen(async (req, res) => {
        try {
          const response = await app.fetch(new Request(new URL(req.url!, 'http://127.0.0.1'), { method: req.method, headers: req.headers as Record<string, string> }), env);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.writeHead(500); res.end(); }
      });
      servers.push(api.server); return api.url;
    }
    const urls = [await startApi(), await startApi()];
    async function account(profileCompleted = true) {
      const id = randomUUID();
      await sql`INSERT INTO "user" (id, name, email, profile_completed, api_plan, plan_expires_at, created_at, updated_at) VALUES (${id}, 'Integration', ${`${id}@tests.invalid`}, ${profileCompleted}, 'professional', now() + interval '1 month', now(), now())`;
      return id;
    }
    async function key(user: string, state = 'active') {
      const secret = `sm_live_${randomBytes(24).toString('hex')}`;
      await sql`INSERT INTO api_key (id, user_id, name, key_hash, expires_at, revoked_at) VALUES (${randomUUID()}, ${user}, 'Integration', ${createHash('sha256').update(secret).digest('hex')}, ${state === 'expired' ? new Date(0) : null}, ${state === 'revoked' ? new Date() : null})`;
      return secret;
    }
    const user = await account(); const secret = await key(user);
    return { sql, requests, urls, user, secret, account, key, startApi, bindings,
      request: (path: string, token: string | undefined = secret, instance = 0, headers: Record<string, string> = {}) => bufferedFetch(urls[instance]! + path, { headers: { ...(token ? { 'X-API-Key': token } : {}), ...headers }, signal: AbortSignal.timeout(30000) }),
      cleanup: async () => { axios.defaults.adapter = adapter; await Promise.all(servers.map(close)); await sql.end({ timeout: 1 }); },
    };
  } catch (error) { axios.defaults.adapter = adapter; await Promise.all(servers.map(close)); await sql.end(); throw error; }
}
