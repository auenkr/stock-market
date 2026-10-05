/**
 * Black-box API contract suite. Runs purely over HTTP so the same file verifies
 * the TypeScript implementation and any rewrite (e.g. the Rust service).
 *
 * Required context: one or more base URLs serving the same database, a postgres
 * client on that database for seeding, and flags describing the environment.
 * Fixture-source behaviour (MISSING/FAIL/LOGIN symbols, request counting) is only
 * asserted when flags.fixtureSource is true.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { endpointCatalog, type Schema } from '../../src/endpoint-catalog.js';
import { responseSchemas } from '../../src/reference-schemas.js';

export type ContractContext = {
  baseUrls: string[];
  sql: postgres.Sql;
  cacheEnabled: boolean;
  /** Seeded credentials; created by the runner's before hook. */
  keys: { owner: string; secret: string; freeSecret: string };
  flags: { fixtureSource: boolean; multiInstance: boolean; canBreakDatabase: boolean; startApi?: (env: Record<string, string | undefined>) => Promise<string> };
  sourceRequests?: () => string[];
};

export async function seedKeys(sql: postgres.Sql): Promise<ContractContext['keys']> {
  const account = async (plan = 'professional', profileCompleted = true) => {
    const id = randomUUID();
    await sql`INSERT INTO "user" (id, name, email, profile_completed, api_plan, plan_expires_at, created_at, updated_at) VALUES (${id}, 'Contract', ${`${id}@contract.invalid`}, ${profileCompleted}, ${plan}, now() + interval '1 month', now(), now())`;
    return id;
  };
  const key = async (user: string, state: 'active' | 'expired' | 'revoked' = 'active') => {
    const secret = `sm_live_${randomBytes(24).toString('hex')}`;
    await sql`INSERT INTO api_key (id, user_id, name, key_hash, expires_at, revoked_at) VALUES (${randomUUID()}, ${user}, 'Contract', ${createHash('sha256').update(secret).digest('hex')}, ${state === 'expired' ? new Date(0) : null}, ${state === 'revoked' ? new Date() : null})`;
    return secret;
  };
  const owner = await account();
  return { owner, secret: await key(owner), freeSecret: await key(await account('free')) };
}

/** Runs the suite sequentially. Await it at module top level (never inside a
 * before hook) so the test runner schedules each test in order. The runner must
 * have finished setup (fixture servers, seeded keys) before calling. */
export async function defineContractSuite(ctx: ContractContext) {
  const shape = (value: any, schema: Schema, path: string) => {
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
  };
  const request = async (path: string, token?: string, instance = 0, headers: Record<string, string> = {}) => {
    // Like the historical grey-box harness, an omitted token uses the valid
    // suite key; pass '' explicitly for unauthenticated requests.
    const key = token === undefined ? ctx.keys.secret : token;
    const response = await fetch(ctx.baseUrls[instance]! + path, {
      headers: { ...(key ? { 'X-API-Key': key } : {}), ...headers },
      signal: AbortSignal.timeout(30000),
    });
    const bytes = await response.arrayBuffer();
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  async function account(plan = 'professional', profileCompleted = true) {
    const id = randomUUID();
    await ctx.sql`INSERT INTO "user" (id, name, email, profile_completed, api_plan, plan_expires_at, created_at, updated_at) VALUES (${id}, 'Contract', ${`${id}@contract.invalid`}, ${profileCompleted}, ${plan}, now() + interval '1 month', now(), now())`;
    return id;
  }
  async function key(user: string, state: 'active' | 'expired' | 'revoked' = 'active') {
    const secret = `sm_live_${randomBytes(24).toString('hex')}`;
    await ctx.sql`INSERT INTO api_key (id, user_id, name, key_hash, expires_at, revoked_at) VALUES (${randomUUID()}, ${user}, 'Contract', ${createHash('sha256').update(secret).digest('hex')}, ${state === 'expired' ? new Date(0) : null}, ${state === 'revoked' ? new Date() : null})`;
    return secret;
  }

  const { secret, freeSecret } = ctx.keys;

  await test('public surface: health, docs, specs, CORS, 404 shape and request IDs', async () => {
    const home = await request('/', ''); assert.equal(home.status, 200); assert.match(home.headers.get('content-type')!, /html/);
    const health = await request('/health', ''); assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', service: 'stock-market-api', version: '1.2.0' });
    for (const path of ['/docs', '/openapi.json', '/swagger.json', '/plugin/openapi.json', '/.well-known/ai-plugin.json']) {
      const response = await request(path, ''); assert.equal(response.status, 200, path); await response.text();
    }
    const openapi = await (await request('/openapi.json', '')).json() as any;
    assert.deepEqual(await (await request('/swagger.json', '')).json(), openapi);
    assert.equal(openapi.openapi, '3.0.3'); assert.deepEqual(openapi.security, [{ apiKey: [] }]);
    const preflight = await fetch(ctx.baseUrls[0] + '/v1/coverage', { method: 'OPTIONS', headers: { Origin: 'https://dashboard.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-API-Key' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), '*'); await preflight.text();
    // Unknown routes fail closed under the authorized prefixes (401 without a
    // key); every unknown route returns the exact envelope once authorized.
    // The auth middleware only guards /v1/, /v2/ and /api/, so a bare unknown
    // path is a public 404.
    for (const path of ['/v1/stock-symbols', '/v2/quote']) {
      assert.equal((await request(path, '')).status, 401, path);
      const response = await request(path); assert.equal(response.status, 404, path);
      assert.deepEqual(await response.json(), { error: 'Endpoint not found', code: 'NOT_FOUND' });
    }
    for (const path of ['/does-not-exist']) {
      for (const token of ['', ctx.keys.secret]) {
        const response = await request(path, token); assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: 'Endpoint not found', code: 'NOT_FOUND' });
      }
    }
    // Wrong method on a real route is also a 404 with the same envelope.
    const wrongMethod = await fetch(ctx.baseUrls[0] + '/v1/company-search?q=acme', { method: 'POST', headers: { 'X-API-Key': secret } });
    assert.equal(wrongMethod.status, 404); assert.deepEqual(await wrongMethod.json(), { error: 'Endpoint not found', code: 'NOT_FOUND' });
    const ids = new Set<string>();
    for (const path of ['/health', '/v1/coverage', '/v1/company-search?q=acme', '/does-not-exist']) {
      const response = await request(path, secret);
      const id = response.headers.get('x-request-id'); assert(id, path); assert(!ids.has(id), `duplicate ${id}`); ids.add(id!); await response.text();
    }
  });

  await test('authorization: exact 401 envelope, key transports, expiry, revocation and profile gating', async () => {
    const invalid = { error: 'Invalid or expired API key', code: 'INVALID_OR_EXPIRED_API_KEY' };
    for (const path of ['/v1/coverage', '/api/v1/company-profile?symbol=/company/ACME/', '/v1/basic-financials?symbol=/company/ACME/', '/api/company-search?q=acme']) {
      for (const token of ['', 'invalid', `sm_live_${'0'.repeat(48)}`]) {
        const response = await request(path, token); assert.equal(response.status, 401, `${path} ${token.slice(0, 8)}`);
        assert.deepEqual(await response.json(), invalid, path);
        assert.equal(response.headers.get('cache-control'), 'no-store', path);
      }
    }
    // Malformed Bearer credentials are rejected without reaching the source.
    for (const headers of [{ Authorization: 'Bearer' }, { Authorization: 'Token abc' }, { Authorization: `Bearer ${secret.slice(0, 10)}` }]) {
      const response = await request('/v1/coverage', '', 0, headers); assert.equal(response.status, 401); assert.deepEqual(await response.json(), invalid);
    }
    // Bearer works; X-API-Key wins when both are sent; surrounding whitespace is trimmed.
    assert.equal((await request('/v1/coverage', '', 0, { Authorization: `Bearer ${secret}` })).status, 200);
    assert.equal((await request('/v1/coverage', 'invalid', 0, { Authorization: `Bearer ${secret}` })).status, 401);
    assert.equal((await request('/v1/coverage', `  ${secret}  `)).status, 200);
    const user = await account();
    for (const state of ['expired', 'revoked'] as const) assert.equal((await request('/v1/coverage', await key(user, state))).status, 401);
    const unfinished = await account('professional', false); const unfinishedKey = await key(unfinished);
    assert.equal((await request('/v1/coverage', unfinishedKey)).status, 401);
    await ctx.sql`UPDATE "user" SET profile_completed = true WHERE id = ${unfinished}`;
    assert.equal((await request('/v1/coverage', unfinishedKey)).status, 200);
    const live = await key(user); assert.equal((await request('/v1/coverage', live)).status, 200);
    await ctx.sql`UPDATE api_key SET revoked_at = now() WHERE user_id = ${user}`;
    assert.equal((await request('/v1/coverage', live)).status, 401);
  });

  await test('authorization outage fails closed but leaves public routes up', { skip: !ctx.flags.canBreakDatabase || !ctx.flags.startApi }, async () => {
    const broken = await ctx.flags.startApi!({ DB_CONNECTION_URL: '' });
    const response = await fetch(broken + '/v1/coverage', { headers: { 'X-API-Key': secret } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Account usage service unavailable', code: 'ACCOUNT_USAGE_SERVICE_UNAVAILABLE' });
    assert.equal((await fetch(broken + '/health')).status, 200);
  });

  await test('coverage document: access policy, journey and endpoint contracts', async () => {
    const response = await request('/v1/coverage'); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as any;
    assert.equal(body.inspectedAt, '2026-10-03');
    assert.deepEqual(body.accessPolicy.freeCompanies, ['RELIANCE', 'HDFCBANK', 'BHARTIARTL', 'ICICIBANK', 'SBIN']);
    assert.equal(body.accessPolicy.rankedBy, 'market-capitalization'); assert.equal(body.accessPolicy.asOf, '2026-10-01');
    for (const plan of ['free', 'basic', 'personal', 'professional']) assert.equal(typeof body.accessPolicy.requestsPerMinute[plan], 'number');
    assert.deepEqual(body.userJourney.map((g: any) => g.id), ['company-search', 'company-overview', 'finance', 'internal']);
    body.userJourney.forEach((group: any, i: number) => assert.equal(group.order, i + 1));
    assert(Array.isArray(body.endpoints) && body.endpoints.length > 0);
    for (const endpoint of body.endpoints) {
      assert.equal(typeof endpoint.path, 'string'); assert.equal(typeof endpoint.useCase, 'string'); assert.equal(typeof endpoint.order, 'number');
      assert(!('response' in endpoint) && !('parameters' in endpoint));
    }
  });

  await test('every catalogue route preserves status, shape, coverage headers and personal aliases', async () => {
    const values: Record<string, string> = { symbol: 'ACME', symbols: 'ACME', statement_type: 's', statement_code: 'pl', period: 'annual', ratio_type: 'pr', group: 'sub_industry', value: 'Widgets', from_date: '2024-01-01', to_date: '2024-12-31', corp_action: 'bonus', category: 'monthly_index', code: '123', index_symbol: 'NIF50' };
    for (const contract of endpointCatalog) {
      const query = new URLSearchParams();
      for (const parameter of contract.parameters) if (parameter.required && parameter.in === 'query') query.set(parameter.name, parameter.name === 'symbol' ? '/company/ACME/' : values[parameter.name]!);
      const path = contract.path.replace(/\{([^}]+)\}/g, (_, name: string) => values[name]!) + `?${query}`;
      const response = await request(path);
      assert.equal(response.status, contract.status === 'excluded' ? 404 : contract.status === 'unavailable' ? 501 : 200, path);
      const body = await response.json() as any;
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
      assert.equal(response.headers.get('x-data-source'), null, path);
      if (contract.status === 'partial') {
        shape(body, contract.response, path);
        assert.equal(response.headers.get('x-data-coverage'), 'partial', path);
        // The auth middleware re-stamps Cache-Control after the handler, so
        // every authorized response is no-store in practice.
        assert.equal(response.headers.get('cache-control'), 'no-store', path);
        if (['results-calendar', 'corporate-actions/all', 'corporate-actions'].includes(contract.resource)) assert(response.headers.get('x-page') !== null, `${path} x-page`);
      } else if (contract.status === 'unavailable') {
        assert.equal(body.code, 'DATASET_UNAVAILABLE', path);
      } else {
        assert.deepEqual(body, { error: 'Endpoint not found', code: 'NOT_FOUND' }, path);
      }
      if (contract.path.startsWith('/api/v') && contract.status !== 'excluded') {
        const alias = await request(path.replace(/^\/api/, '')); assert.equal(alias.status, response.status); assert.deepEqual(await alias.json(), body, path);
      }
    }
  });

  await test('catalogue failures carry endpoint and docs pointers', async () => {
    const response = await request('/v1/profit-loss');
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'symbol parameter is required', code: 'INVALID_QUERY', endpoint: '/api/v1/profit-loss', docs: '/v1/coverage' });
  });

  await test('legacy envelopes: listing, search, IPO, company data and extraction', async () => {
    const list = await (await request('/v1/list-of-company?page=1')).json() as any;
    assert.deepEqual(Object.keys(list).sort(), ['data', 'meta']);
    assert.deepEqual(list.meta, { currentPage: 1, limit: 100, count: 1, isNextPageAvailable: true, nextPage: 2, previousPage: null });
    assert.equal(list.data[0].symbol, '/company/ACME/'); assert(!('url' in list.data[0])); assert(!('skip' in list.data[0]));
    assert.deepEqual(await (await request('/api/list-of-company?page=1')).json(), list);
    const next = await (await request('/v1/list-of-company?page=2')).json() as any;
    assert.equal(next.meta.previousPage, 1); assert.equal(next.meta.nextPage, null);
    const search = await (await request('/v1/company-search?q=acme')).json() as any;
    assert.deepEqual(search.data, search.results); assert.equal(search.data[0].symbol, '/company/ACME/'); assert(!('url' in search.data[0]));
    const ipo = await (await request('/v1/list-of-ipo')).json() as any; assert.deepEqual(ipo.data, []); assert.deepEqual(ipo.ipos, ipo.data);
    const companyPath = '/v1/company-data?symbol=%2Fcompany%2FLEGACY%2F';
    const cold = await request(companyPath); assert.equal(cold.status, 200);
    assert.equal(cold.headers.get('cache-control'), 'no-store');
    const body = await cold.json() as any;
    assert.deepEqual(body.data, body.companyData); assert.deepEqual(body.data.metrics, []);
    assert.equal(body.data.symbol, '/company/LEGACY/'); assert(!('url' in body.data));
    const warm = await request(companyPath);
    assert.equal(warm.headers.get('x-cache'), ctx.cacheEnabled ? 'HIT' : null);
    if (ctx.cacheEnabled) assert.deepEqual(await warm.json(), body);
    assert.deepEqual(await (await request(companyPath.replace('/v1/', '/api/'))).json(), body);
    for (const type of ['quarterly', 'profit-loss', 'balance-sheet', 'cash-flow', 'ratios', 'shareholding', 'peers']) {
      const result = await request(`/v1/extract?symbol=/company/LEGACY/&type=${type}`); assert.equal(result.status, 200, type);
      const extract = await result.json() as any; assert(Array.isArray(extract.data)); assert.equal(extract.meta.type, type); assert.equal(extract.meta.cached, ctx.cacheEnabled);
      assert.equal(extract.meta.symbol, '/company/LEGACY/'); assert(!('endpoint' in extract.meta));
    }
    for (const company of ['/company/id/1286218/', '/company/GVT&D/consolidated/']) {
      const response = await request('/v1/company-data?' + new URLSearchParams({ symbol: company }));
      assert.equal(response.status, 200, company);
      const payload = await response.json() as any; assert.deepEqual(payload.data, payload.companyData);
    }
  });

  await test('paid tiers and free-company allowlist are enforced with exact codes', async () => {
    assert.equal((await request('/v1/coverage', freeSecret)).status, 200);
    for (const path of ['/v1/company-data?symbol=/company/RELIANCE/', '/v1/extract?symbol=/company/RELIANCE/&type=quarterly']) {
      assert.equal((await request(path, freeSecret)).status, 403, path);
      assert.deepEqual(await (await request(path, freeSecret)).json(), { error: 'This endpoint requires Personal or Professional', code: 'PAID_PLAN_REQUIRED', docs: '/v1/coverage' }, path);
    }
    // Tier is checked before the company allowlist: paid resources stay 403
    // for free plans regardless of symbol; free resources check the company.
    // Compatibility rejections are raised inside the route, so they carry the
    // canonical endpoint pointer; the legacy middleware gate does not.
    for (const [path, endpoint] of [['/v1/profit-loss?symbol=/company/ACME/', '/api/v1/profit-loss'], ['/v1/profit-loss?symbol=/company/RELIANCE/', '/api/v1/profit-loss']] as const) {
      const response = await request(path, freeSecret); assert.equal(response.status, 403, path);
      assert.deepEqual(await response.json(), { error: 'This endpoint requires Personal or Professional', code: 'PAID_PLAN_REQUIRED', endpoint, docs: '/v1/coverage' }, path);
    }
    const restricted = await request('/v1/company-profile?symbol=/company/ACME/', freeSecret);
    assert.equal(restricted.status, 403);
    assert.match((await restricted.json() as any).error, /Free company endpoints are limited to/);
    assert.equal((await request('/v1/company-profile?symbol=/company/RELIANCE/', freeSecret)).status, 200);
  });

  await test('invalid queries fail fast with INVALID_QUERY and valid unknown routes stay 404', async () => {
    // Legacy adapters derive the code from the message; the catalogue uses INVALID_QUERY.
    const legacyCodes: Record<string, string> = { '/v1/company-search': 'Q_PARAMETER_IS_REQUIRED' };
    for (const path of ['/v1/company-search', '/v1/list-of-company?page=0', '/v1/list-of-company?page=1.5', '/v1/company-data?symbol=ACME', '/v1/company-data?companyUrl=https://example.com/company/ACME/', '/v1/extract?endpoint=/company/ACME/&type=price-history']) {
      const response = await request(path); assert.equal(response.status, 400, path);
      const body = await response.json() as any; assert.equal(typeof body.error, 'string', path);
      if (legacyCodes[path]) assert.equal(body.code, legacyCodes[path], path);
    }
    for (const path of ['/v1/company-data?companyUrl=/company/ACME/../../admin/']) {
      const response = await request(path); assert.equal(response.status, 400, path);
      assert.equal(typeof (await response.json() as any).error, 'string', path);
    }
    for (const path of ['/v1/profit-loss', '/v1/company-profile?symbol=/company/ACME/&unknown=true', '/v1/results-calendar?from_date=2024-02-30&to_date=2024-05-01', '/v1/results-calendar?from_date=2024-05-02&to_date=2024-05-01']) {
      const response = await request(path); assert.equal(response.status, 400, path);
      assert.equal((await response.json() as any).code, 'INVALID_QUERY', path);
    }
    for (const resource of ['peer-comparison', 'quarterly-profit-loss', 'profit-loss', 'balance-sheet', 'cash-flow', 'ratios', 'shareholding-pattern', 'shareholdings/distribution']) {
      for (const extra of ['statement_type=c', 'statement_code=pl', 'period=annual', 'ratio_type=pr', 'group=sector', 'page=1']) assert.equal((await request(`/v1/${resource}?symbol=/company/ACME/&${extra}`)).status, 400, `${resource} ${extra}`);
    }
    for (const path of ['/v1/quote', '/v1/corporate-actions/split/ACME', '/enterprise/api/quotes?symbol=ACME']) {
      const response = await request(path); assert.equal(response.status, 404, path);
      assert.deepEqual(await response.json(), { error: 'Endpoint not found', code: 'NOT_FOUND' }, path);
    }
  });

  await test('upstream failures map to stable codes and stay no-store', { skip: !ctx.flags.fixtureSource }, async () => {
    for (const [symbol, status, code] of [['MISSING', 404, 'NOT_FOUND'], ['FAIL', 502, 'UPSTREAM_UNAVAILABLE'], ['LOGIN', 502, 'SOURCE_AUTH_REQUIRED']] as const) {
      const response = await request(`/v1/company-profile?symbol=/company/${symbol}/`);
      assert.equal(response.status, status); assert.equal((await response.json() as any).code, code);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });

  await test('upstream failures are never cached', { skip: !ctx.flags.fixtureSource || !ctx.sourceRequests }, async () => {
    for (const [symbol, status, code] of [['MISSING', 404, 'NOT_FOUND'], ['FAIL', 502, 'UPSTREAM_UNAVAILABLE'], ['LOGIN', 502, 'SOURCE_AUTH_REQUIRED']] as const) {
      const before = ctx.sourceRequests!().length;
      for (let i = 0; i < 2; i++) {
        const response = await request(`/v1/company-profile?symbol=/company/${symbol}/`);
        assert.equal(response.status, status); assert.equal((await response.json() as any).code, code);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      assert.equal(ctx.sourceRequests!().length, before + 2);
    }
  });

  await test('quota is atomic across keys and instances, isolated per account, and resets with the window', async () => {
    await ctx.sql`UPDATE usage_policy SET request_limit = 10 WHERE id = 'professional'`;
    try {
      const ownerId = await account(); const keys = [await key(ownerId), await key(ownerId)];
      const instances = ctx.flags.multiInstance ? [0, 1] : [0, 0];
      const responses = await Promise.all(Array.from({ length: 14 }, (_, i) => request('/v1/coverage', keys[i % 2], instances[i % 2])));
      assert.equal(responses.filter((r) => r.status === 200).length, 10);
      assert.equal(responses.filter((r) => r.status === 429).length, 4);
      for (const response of responses) {
        if (response.status === 429) {
          const retry = Number(response.headers.get('retry-after')); assert(retry > 0 && retry <= 60);
          assert.deepEqual(await response.json(), { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' });
        } else await response.text();
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      const [usage] = await ctx.sql`SELECT request_count FROM account_usage WHERE user_id = ${ownerId}`;
      assert.equal(usage!.request_count, 10);
      assert.equal((await request('/v1/coverage', await key(await account()))).status, 200);
      assert.equal((await request('/health', keys[0])).status, 200);
      await ctx.sql`UPDATE account_usage SET window_started_at = now() - interval '61 seconds' WHERE user_id = ${ownerId}`;
      assert.equal((await request('/v1/coverage', keys[1], instances[1])).status, 200);
      const [reset] = await ctx.sql`SELECT request_count FROM account_usage WHERE user_id = ${ownerId}`;
      assert.equal(reset!.request_count, 1);
    } finally { await ctx.sql`UPDATE usage_policy SET request_limit = 10000 WHERE id = 'professional'`; }
  });

  await test('concurrent cache misses coalesce into one source request', { skip: !ctx.flags.fixtureSource || !ctx.sourceRequests || !ctx.cacheEnabled }, async () => {
    const path = '/company/COALESCED/';
    const before = ctx.sourceRequests!().filter((p) => p === path).length;
    const responses = await Promise.all(Array.from({ length: 6 }, () => request('/v1/company-profile?symbol=/company/COALESCED/')));
    for (const response of responses) { assert.equal(response.status, 200); await response.text(); }
    assert.equal(ctx.sourceRequests!().filter((p) => p === path).length, before + 1);
  });
}
