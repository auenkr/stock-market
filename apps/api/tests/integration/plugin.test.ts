import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { agentPluginManifest, agentTools } from '@stock-market/agent-tools';
import { setup } from '../harness.js';

let fixture: Awaited<ReturnType<typeof setup>>;
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.cleanup(); });

async function getJson(path: string, token?: string) {
  const response = await fixture.request(path, token === undefined ? fixture.secret : token);
  assert.equal(response.status, 200, `${path} -> ${response.status}`);
  return response.json() as Promise<any>;
}

test('plugin manifest is served, valid, and keys against the same API key auth', async () => {
  const response = await fixture.request('/.well-known/ai-plugin.json', '');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
  const manifest = await response.json() as any;
  assert.equal(manifest.schema_version, 'v1');
  assert.equal(manifest.name_for_model, 'stock_market_api');
  assert.equal(manifest.auth?.type, 'api_key');
  assert.equal(manifest.auth?.in, 'header');
  assert.equal(manifest.auth?.name, 'X-API-Key');
  assert(manifest.description_for_model.includes('symbol'));
  assert(manifest.api?.url?.endsWith('/plugin/openapi.json'));
  assert(Array.isArray(manifest.tools) && manifest.tools.length >= 13);
  for (const tool of manifest.tools) {
    assert.match(tool.name, /^get_/);
    assert(tool.description.length > 20, tool.name);
  }
  // Public manifest requires no key; protected plugin openapi path check below.
  assert.equal(manifest.name_for_human.length > 0, true);
});

test('plugin OpenAPI exposes only agents tools and never Internal endpoints', async () => {
  const spec = await getJson('/plugin/openapi.json');
  assert.equal(spec.openapi, '3.0.3');
  assert.deepEqual(spec.security, [{ apiKey: [] }]);
  assert(spec.servers?.[0]?.url);
  const tagNames = (spec.tags ?? []).map((t: any) => t.name);
  assert(!tagNames.includes('Internal'), tagNames.join(','));
  const paths = Object.entries(spec.paths ?? {}) as Array<[string, any]>;
  assert(paths.length >= 13, `expected at least 13 tool paths, got ${paths.length}`);
  for (const [path, entry] of paths) {
    const operation = entry.get;
    assert(operation, `GET missing for ${path}`);
    assert.match(operation.operationId, /^get_/);
    assert.notEqual(operation['x-use-case'], 'internal', path);
    assert.notEqual(operation['x-api-style'], 'service', path);
    assert.notEqual(operation['x-alias'], true, path);
    assert(operation.responses?.['401'], path);
  }
  for (const forbidden of ['/v1/company-data', '/v1/extract', '/v1/list-of-ipo', '/v1/coverage', '/v1/corporate-actions', '/v1/results-calendar']) {
    assert(!spec.paths[forbidden], `${forbidden} must not be exposed`);
    assert(!spec.paths[forbidden.replace('/v1', '/api/v1')], `${forbidden} alias must not be exposed`);
  }
});

test('plugin tool contract matches the shared agent-tools manifest', async () => {
  const spec = await getJson('/plugin/openapi.json');
  const full = await getJson('/openapi.json');
  const tools = agentTools(full);
  const specNames = Object.values(spec.paths).map((entry: any) => entry.get.operationId).sort();
  assert.deepEqual(tools.map((t) => t.name).sort(), specNames);
  const local = agentPluginManifest('http://localhost:8787', tools);
  assert.equal(local.api.url, 'http://localhost:8787/plugin/openapi.json');
});

test('every plugin tool endpoint works end to end through the same auth and fixture source', async () => {
  const spec = await getJson('/plugin/openapi.json');
  const values: Record<string, string> = { q: 'acme', page: '1', symbol: '/company/ACME/' };
  for (const [path, entry] of Object.entries(spec.paths) as Array<[string, any]>) {
    const operation = entry.get;
    const query = new URLSearchParams();
    for (const parameter of operation.parameters ?? []) {
      if (parameter.required && parameter.in === 'query') query.set(parameter.name, values[parameter.name] ?? '/company/ACME/');
    }
    const response = await fixture.request(`${path}?${query}`);
    assert.equal(response.status, 200, `${path} -> ${response.status}`);
    assert(response.headers.get('x-request-id'), path);
    await response.json();
    await response.text().catch(() => undefined);
  }
});

test('plugin endpoints do not leak source attribution or allow unauthenticated API calls', async () => {
  const publicPlugin = await fixture.request('/plugin/openapi.json', '');
  assert.equal(publicPlugin.status, 200);
  const response = await fixture.request('/v1/company-profile?symbol=/company/ACME/', '');
  assert.equal(response.status, 401);
  const profile = await fixture.request('/v1/company-profile?symbol=/company/ACME/');
  const body = await profile.json() as any;
  assert(!('data_source' in body) && !('provider' in body));
});
