import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const web = 'https://stock-market-web-dev.vercel.app';
const api = 'https://stock-market-api-dev.auenkr.com';
const mcp = 'https://stock-market-mcp-dev.auenkr.com';

async function request(url, status = 200, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000), redirect: 'manual' });
      assert.equal(response.status, status, `${url}: unexpected HTTP status`);
      return response;
    } catch (error) {
      if (attempt === 5) throw error;
      await setTimeout(5_000);
    }
  }
}

await request(`${web}/signin`);
assert.equal(await (await request(`${web}/api/auth/get-session`)).json(), null);
await request(`${api}/health`);
await request(`${mcp}/health`);
const spec = await (await request(`${api}/openapi.json`)).json();
assert.ok(spec.servers.some(server => server.url.startsWith(api)));
assert.ok(spec.paths['/v1/dividend'], 'Dev-only API documentation must be enabled');
const resource = await (await request(`${mcp}/.well-known/oauth-protected-resource`)).json();
assert.equal(resource.resource, `${mcp}/mcp`);
assert.deepEqual(resource.authorization_servers, [`${web}/api/auth`]);
assert.equal(resource.resource_documentation, `${web}/docs`);
const issuer = await (await request(`${web}/.well-known/oauth-authorization-server/api/auth`)).json();
assert.equal(issuer.issuer, `${web}/api/auth`);
await request(`${mcp}/mcp`, 401);
// A syntactically valid unknown key exercises API → web → dev database.
await request(`${api}/v1/coverage`, 401, { headers: { 'X-API-Key': `sm_live_${'0'.repeat(48)}` } });
// An unknown OAuth token exercises the signed MCP → web account-service request.
await request(`${mcp}/mcp`, 401, { headers: { Authorization: 'Bearer dev-smoke-invalid-token' } });
console.log('Development web, API, MCP, documentation, OAuth discovery and account-service smoke checks passed.');
