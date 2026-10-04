import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { endpointCatalog, type Schema } from '../../src/endpoint-catalog.js';
import { responseSchemas } from '../../src/reference-schemas.js';
import { setup, listen, close, bufferedFetch } from '../harness.js';
import { createHmac } from 'node:crypto';
import { db } from '@stock-market/db';
import { POST } from '../../../web/src/app/api/internal/account-access/route.js';

let fixture: Awaited<ReturnType<typeof setup>>;
before(async () => { fixture = await setup(); });
after(async () => { try { await fixture?.cleanup(); } finally { await db.$client.end({ timeout: 1 }); } });

function shape(value: any, schema: Schema, path: string) {
  if (schema.$ref) return shape(value, responseSchemas[schema.$ref.split('/').at(-1)!]!, path);
  if (value === null && schema.nullable) return;
  if (!schema.type) return;
  if (schema.type === 'array') { assert(Array.isArray(value), path); value.forEach((item: any) => shape(item, schema.items!, path)); return; }
  if (schema.type === 'object') {
    assert(value && typeof value === 'object' && !Array.isArray(value), path);
    for (const name of schema.required ?? []) assert(name in value, `${path}.${name}`);
    for (const [name, child] of Object.entries(schema.properties ?? {})) if (name in value) shape(value[name], child, `${path}.${name}`);
    if (typeof schema.additionalProperties === 'object') for (const [name, child] of Object.entries(value)) if (!schema.properties?.[name]) shape(child, schema.additionalProperties, `${path}.${name}`);
    return;
  }
  assert.equal(typeof value, schema.type === 'integer' ? 'number' : schema.type, path);
  if (schema.type === 'integer') assert(Number.isInteger(value), path);
  if (schema.type === 'number') assert(Number.isFinite(value), path);
  if (schema.enum) assert(schema.enum.includes(value), path);
}

test('public health, docs and contracts; CORS preflight; protected paths fail closed', async () => {
  for (const path of ['/', '/health', '/docs', '/openapi.json', '/swagger.json']) {
    const response = await fixture.request(path, ''); assert.equal(response.status, 200, path); assert(response.headers.get('x-request-id')); await response.text();
  }
  const openapi = await (await fixture.request('/openapi.json', '')).json() as any;
  assert.deepEqual(await (await fixture.request('/swagger.json', '')).json(), openapi);
  assert.equal(openapi.openapi, '3.0.3'); assert.deepEqual(openapi.security, [{ apiKey: [] }]);
  for (const path of ['/v1/coverage', '/api/v1/company-profile?symbol=/company/ACME/', '/v1/basic-financials?symbol=/company/ACME/', '/api/company-search?q=acme']) {
    assert.equal((await fixture.request(path, '')).status, 401, path);
    assert.equal((await fixture.request(path, 'invalid')).status, 401, path);
  }
  const preflight = await fetch(fixture.urls[0] + '/v1/coverage', { method: 'OPTIONS', headers: { Origin: 'https://dashboard.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-API-Key' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const bearer = await fixture.request('/v1/coverage', '', 0, { Authorization: `Bearer ${fixture.secret}` }); assert.equal(bearer.status, 200);
  const broken = await fixture.startApi({ ...fixture.bindings, DB_CONNECTION_URL: '' });
  const response = await fetch(broken + '/v1/coverage', { headers: { 'X-API-Key': fixture.secret } });
  assert.equal(response.status, 503); assert.equal((await response.json() as any).code, 'ACCOUNT_USAGE_SERVICE_UNAVAILABLE');
  assert.equal((await fetch(broken + '/health')).status, 200);
});

test('every catalogue route preserves its schema, coverage, gaps and personal aliases over HTTP', async () => {
  const values: Record<string, string> = { symbol: 'ACME', symbols: 'ACME', statement_type: 's', statement_code: 'pl', period: 'annual', ratio_type: 'pr', group: 'sub_industry', value: 'Widgets', from_date: '2024-01-01', to_date: '2024-12-31', corp_action: 'bonus', category: 'monthly_index', code: '123', index_symbol: 'NIF50' };
  for (const contract of endpointCatalog) {
    const query = new URLSearchParams();
    for (const parameter of contract.parameters) if (parameter.required && parameter.in === 'query') query.set(parameter.name, parameter.name === 'symbol' ? '/company/ACME/' : values[parameter.name]!);
    const path = contract.path.replace(/\{([^}]+)\}/g, (_, name: string) => values[name]!) + `?${query}`;
    const response = await fixture.request(path);
    const unavailable = contract.status === 'unavailable';
    assert.equal(response.status, contract.status === 'excluded' ? 404 : unavailable ? 501 : 200, path);
    const body = await response.json() as any;
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    assert.equal(response.headers.get('x-data-source'), null, path);
    if (contract.status === 'partial' && !unavailable) { shape(body, contract.response, path); assert.equal(response.headers.get('x-data-coverage'), 'partial'); }
    if (unavailable) assert.equal(body.code, 'DATASET_UNAVAILABLE', path);
    if (contract.path.startsWith('/api/v') && contract.status !== 'excluded') {
      const alias = await fixture.request(path.replace(/^\/api/, '')); assert.equal(alias.status, response.status); assert.deepEqual(await alias.json(), body, path);
    }
  }
});

test('legacy listing/search/IPO envelopes, pagination, exact company paths, cache and extraction', async () => {
  const cached = fixture.bindings.CACHE_ENABLED === 'true';
  const list = await (await fixture.request('/v1/list-of-company?page=1')).json() as any;
  assert.deepEqual(Object.keys(list).sort(), ['data', 'meta']);
  assert.deepEqual(list.meta, { currentPage: 1, limit: 100, count: 1, isNextPageAvailable: true, nextPage: 2, previousPage: null });
  assert.equal(list.data[0].symbol, '/company/ACME/'); assert(!('url' in list.data[0])); assert(!('skip' in list.data[0]));
  assert.deepEqual(await (await fixture.request('/api/list-of-company?page=1')).json(), list);
  const next = await (await fixture.request('/v1/list-of-company?page=2')).json() as any;
  assert.equal(next.meta.previousPage, 1); assert.equal(next.meta.nextPage, null);
  const search = await (await fixture.request('/v1/company-search?q=acme')).json() as any;
  assert.deepEqual(search.data, search.results); assert.equal(search.data[0].symbol, '/company/ACME/'); assert(!('url' in search.data[0]));
  const ipo = await (await fixture.request('/v1/list-of-ipo')).json() as any; assert.deepEqual(ipo.data, []); assert.deepEqual(ipo.ipos, ipo.data);
  const path = '/v1/company-data?symbol=%2Fcompany%2FLEGACY%2F';
  const before = fixture.requests.filter(path => path === '/company/LEGACY/').length;
  const cold = await fixture.request(path); assert.equal(cold.status, 200); const body = await cold.json() as any;
  assert.deepEqual(body.data, body.companyData); assert.deepEqual(body.data.metrics, []);
  assert.equal(body.data.symbol, '/company/LEGACY/'); assert(!('url' in body.data));
  const sameCompany = (actual: any) => assert.deepEqual(actual, cached ? body : {
    ...body, data: { ...body.data, timeStamp: actual.data.timeStamp }, companyData: { ...body.companyData, timeStamp: actual.companyData.timeStamp },
  });
  const warm = await fixture.request(path); assert.equal(warm.headers.get('x-cache'), cached ? 'HIT' : null); sameCompany(await warm.json());
  assert.equal(fixture.requests.filter(path => path === '/company/LEGACY/').length, before + (cached ? 1 : 2));
  sameCompany(await (await fixture.request(path.replace('/v1/', '/api/'))).json());
  for (const type of ['quarterly', 'profit-loss', 'balance-sheet', 'cash-flow', 'ratios', 'shareholding', 'peers']) {
    const result = await fixture.request(`/v1/extract?symbol=/company/LEGACY/&type=${type}`); assert.equal(result.status, 200);
    const extract = await result.json() as any; assert(Array.isArray(extract.data)); assert.equal(extract.meta.type, type); assert.equal(extract.meta.cached, cached);
    assert.equal(extract.meta.symbol, '/company/LEGACY/'); assert(!('endpoint' in extract.meta));
  }
  for (const companyPath of ['/company/id/1286218/', '/company/GVT&D/consolidated/']) {
    const response = await fixture.request('/v1/company-data?' + new URLSearchParams({ symbol: companyPath }));
    assert.equal(response.status, 200); assert(fixture.requests.includes(companyPath));
    const company = await response.json() as any; assert.deepEqual(company.data, company.companyData);
  }
  assert(!fixture.requests.some(path => path.includes('/chart/')));
});

test('financial units, merged overview/documents and URL-based consolidated selection', async () => {
  const response = await fixture.request('/v1/profit-loss?symbol=/company/ACME/consolidated/');
  const body = await response.json() as any; assert.equal(response.status, 200); assert.equal(body.financials[2].revenueFromOperations, 1200000000); assert.equal(body.financials[2].EPS, 4.24);
  assert(fixture.requests.includes('/company/ACME/consolidated/'));
  assert.equal(body.financials[2].ebit, 570000000); assert.equal(body.financials[3].header, 'TTM');
  const overview = await (await fixture.request('/v1/basic-financials?symbol=/company/ACME/')).json() as any;
  assert.equal(overview.basicFinance.price, 100); assert.equal(overview.summary['Market Cap'], 1234); assert.deepEqual(overview.analysis.pros, ['Strong operating cash flow.']);
  const documents = await (await fixture.request('/v1/company-documents?symbol=/company/ACME/')).json() as any;
  assert.equal(documents.documents.annualReports.length, 1); assert.equal(documents.documents.callTranscripts[0].date, null);
  const peers = await (await fixture.request('/v1/peer-comparison?symbol=/company/ACME/')).json() as any;
  assert.equal(peers.peers[0].symbol, '/company/DEMO/'); assert.equal(peers.peers[0].marketCap, 10);
});

test('invalid queries do not fetch sources and unavailable combinations stay explicit', async () => {
  const count = fixture.requests.length;
  for (const path of ['/v1/company-search', '/v1/list-of-company?page=0', '/v1/list-of-company?page=1.5', '/v1/company-data?symbol=ACME', '/v1/company-data?companyUrl=https://example.com/company/ACME/', '/v1/company-data?companyUrl=/company/ACME/../../admin/', '/v1/extract?endpoint=/company/ACME/&type=price-history', '/v1/profit-loss', '/v1/company-profile?symbol=/company/ACME/&unknown=true', '/v1/results-calendar?from_date=2024-02-30&to_date=2024-05-01', '/v1/results-calendar?from_date=2024-05-02&to_date=2024-05-01']) {
    const response = await fixture.request(path); assert.equal(response.status, 400, path); const body = await response.json() as any; assert.equal(typeof body.error, 'string');
  }
  assert.equal(fixture.requests.length, count);
  for (const resource of ['peer-comparison', 'quarterly-profit-loss', 'profit-loss', 'balance-sheet', 'cash-flow', 'ratios', 'shareholding-pattern', 'shareholdings/distribution']) {
    for (const extra of ['statement_type=c', 'statement_code=pl', 'period=annual', 'ratio_type=pr', 'group=sector', 'page=1']) assert.equal((await fixture.request(`/v1/${resource}?symbol=/company/ACME/&${extra}`)).status, 400);
  }
  assert.equal(fixture.requests.length, count);
  for (const path of ['/v1/stock-symbols', '/v1/stock-search', '/v1/quote', '/v2/quote', '/v1/daily-quotes/ACME', '/v1/company-reports/ACME', '/v1/corp-announcements', '/v1/credit-ratings', '/v1/investor-call-transcripts', '/v1/investor-presentations', '/v1/financials/ACME', '/v1/name-changes', '/v1/symbol-changes', '/v1/segment-revenue/ACME', '/v1/notes/ACME', '/v1/financial-metrics/ACME', '/v1/shareholdings/declaration/ACME', '/v1/shareholdings/beneficial-owners/ACME', '/v1/index/master', '/v1/index/market-price/daily-feed', '/v1/index/price-returns', '/v1/commodity-list', '/v1/commodity-pct-change/123', '/v1/ipo-calendar', '/v1/holidays-calendar', '/v1/corporate-actions/split/ACME']) assert.equal((await fixture.request(path)).status, 404, path);
  assert.equal((await fixture.request('/enterprise/api/company-profile?symbols=ACME', '')).status, 404);
  assert.equal((await fixture.request('/enterprise/api/quotes?symbol=ACME')).status, 404);
  assert.equal((await fixture.request('/does-not-exist', '')).status, 404);
});

test('upstream not-found, unavailable and expired source sessions remain failures and are not cached', async () => {
  for (const [symbol, status, code] of [['MISSING', 404, 'NOT_FOUND'], ['FAIL', 502, 'UPSTREAM_UNAVAILABLE'], ['LOGIN', 502, 'SOURCE_AUTH_REQUIRED']] as const) {
    const before = fixture.requests.length;
    for (let i = 0; i < 2; i++) {
      const response = await fixture.request(`/v1/company-profile?symbol=/company/${symbol}/`); assert.equal(response.status, status); assert.equal((await response.json() as any).code, code); assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(fixture.requests.length, before + 2);
  }
});

test('revoked, expired, unknown and incomplete-profile keys are rejected; live revocation works', async () => {
  const user = await fixture.account();
  for (const state of ['expired', 'revoked']) assert.equal((await fixture.request('/v1/coverage', await fixture.key(user, state))).status, 401);
  const unfinished = await fixture.account(false); const unfinishedKey = await fixture.key(unfinished);
  assert.equal((await fixture.request('/v1/coverage', unfinishedKey)).status, 401);
  await fixture.sql`UPDATE "user" SET profile_completed = true WHERE id = ${unfinished}`;
  assert.equal((await fixture.request('/v1/coverage', unfinishedKey)).status, 200);
  assert.equal((await fixture.request('/v1/coverage', 'sm_live_' + 'f'.repeat(48))).status, 401);
  const key = await fixture.key(user); assert.equal((await fixture.request('/v1/coverage', key)).status, 200);
  await fixture.sql`UPDATE api_key SET revoked_at = now() WHERE user_id = ${user}`;
  assert.equal((await fixture.request('/v1/coverage', key)).status, 401);
});

test('two keys and two HTTP API instances share an atomic account quota, with isolation and window reset', async () => {
  await fixture.sql`UPDATE usage_policy SET request_limit = 10 WHERE id = 'professional'`;
  try {
    const owner = await fixture.account(); const keys = [await fixture.key(owner), await fixture.key(owner)];
    const responses = await Promise.all(Array.from({ length: 14 }, (_, i) => fixture.request('/v1/coverage', keys[i % 2], i % 2)));
    assert.equal(responses.filter(r => r.status === 200).length, 10); assert.equal(responses.filter(r => r.status === 429).length, 4);
    for (const response of responses) {
      if (response.status === 429) { const retry = Number(response.headers.get('retry-after')); assert(retry > 0 && retry <= 60); assert.equal((await response.json() as any).code, 'RATE_LIMIT_EXCEEDED'); }
      else await response.text();
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const [usage] = await fixture.sql`SELECT request_count FROM account_usage WHERE user_id = ${owner}`; assert.equal(usage!.request_count, 10);
    assert.equal((await fixture.request('/v1/coverage', await fixture.key(await fixture.account()))).status, 200);
    assert.equal((await fixture.request('/health', keys[0])).status, 200);
    await fixture.sql`UPDATE account_usage SET window_started_at = now() - interval '61 seconds' WHERE user_id = ${owner}`;
    assert.equal((await fixture.request('/v1/coverage', keys[1], 1)).status, 200);
    const [reset] = await fixture.sql`SELECT request_count FROM account_usage WHERE user_id = ${owner}`; assert.equal(reset!.request_count, 1);
  } finally { await fixture.sql`UPDATE usage_policy SET request_limit = 10000 WHERE id = 'professional'`; }
});


test('concurrent HTTP cache misses coalesce into one real source request', { skip: process.env.TEST_MODE === 'CICD' }, async () => {
  const path = '/company/COALESCED/';
  const before = fixture.requests.filter(p => p === path).length;
  const responses = await Promise.all(Array.from({ length: 6 }, () => fixture.request('/v1/company-profile?symbol=/company/COALESCED/')));
  for (const response of responses) { assert.equal(response.status, 200); await response.text(); }
  assert.equal(fixture.requests.filter(p => p === path).length, before + 1);
});

test('signed account-service HTTP bridge uses real storage and rejects forged, stale and malformed requests', async () => {
  const previousDb = process.env.DB_CONNECTION_URL;
  const previousSecret = process.env.ACCOUNT_SERVICE_SECRET;
  process.env.DB_CONNECTION_URL = fixture.bindings.DB_CONNECTION_URL;
  process.env.ACCOUNT_SERVICE_SECRET = 'integration-only-signing-secret';
  const service = await listen(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const response = await POST(new Request('http://127.0.0.1/api/internal/account-access', { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  });
  try {
    const sign = (body: string, timestamp = String(Date.now()), secret = process.env.ACCOUNT_SERVICE_SECRET!) => ({ 'Content-Type': 'application/json', 'X-Account-Timestamp': timestamp, 'X-Account-Signature': createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex') });
    const body = JSON.stringify({ key: fixture.secret });
    for (const headers of [sign(body, String(Date.now() - 60000)), sign(body, String(Date.now()), 'forged'), {}]) {
      assert.equal((await fetch(service.url, { method: 'POST', headers, body })).status, 401);
    }
    for (const malformed of ['not-json', 'x'.repeat(513)]) assert.equal((await fetch(service.url, { method: 'POST', headers: sign(malformed), body: malformed })).status, 400);
    const [beforeAccess] = await fixture.sql`SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'postgres.js'`;
    const valid = await fetch(service.url, { method: 'POST', headers: sign(body), body });
    assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { status: 'allowed', plan: 'professional' });
    const [afterAccess] = await fixture.sql`SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'postgres.js'`;
    assert.equal(afterAccess!.connections, beforeAccess!.connections, 'Account service must close its connection before responding');
    const bridged = await fixture.startApi({ ...fixture.bindings, ACCOUNT_SERVICE_URL: service.url, ACCOUNT_SERVICE_SECRET: process.env.ACCOUNT_SERVICE_SECRET });
    const request = (url: string, token = fixture.secret) => bufferedFetch(url + '/v1/coverage', { headers: { 'X-API-Key': token } });
    assert.equal((await request(bridged)).status, 200);
    assert.equal((await request(bridged, 'sm_live_' + 'e'.repeat(48))).status, 401);
    const broken = await fixture.startApi({ ...fixture.bindings, ACCOUNT_SERVICE_URL: service.url, ACCOUNT_SERVICE_SECRET: 'wrong-secret' });
    assert.equal((await request(broken)).status, 503);
    const owner = await fixture.account(); const token = await fixture.key(owner);
    await fixture.sql`UPDATE usage_policy SET request_limit = 10 WHERE id = 'professional'`;
    try {
      for (let i = 0; i < 10; i++) assert.equal((await request(bridged, token)).status, 200);
      const limited = await request(bridged, token); assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 0);
    } finally { await fixture.sql`UPDATE usage_policy SET request_limit = 10000 WHERE id = 'professional'`; }
  } finally {
    await close(service.server);
    if (previousDb === undefined) delete process.env.DB_CONNECTION_URL; else process.env.DB_CONNECTION_URL = previousDb;
    if (previousSecret === undefined) delete process.env.ACCOUNT_SERVICE_SECRET; else process.env.ACCOUNT_SERVICE_SECRET = previousSecret;
  }
});

test('web database pool bounds concurrent connections and releases idle sockets', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => db.$client`
    SELECT pg_backend_pid() AS pid, pg_sleep(0.02)
  `));
  const pids = new Set(results.map((rows) => rows[0]!.pid));
  assert.equal(pids.size, 1, 'Serverless instances must not each open a large database pool');
  const pid = [...pids][0];
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const active = await fixture.sql`SELECT pid FROM pg_stat_activity WHERE pid = ${pid}`;
  assert.equal(active.length, 0, 'Idle pool connections must be released so other instances can connect');
  const [reopened] = await db.$client`SELECT 1 AS healthy`;
  assert.equal(reopened!.healthy, 1, 'The pool must reconnect after idle cleanup');
});
