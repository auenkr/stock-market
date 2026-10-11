import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer, parseArgs } from '../src/index.js';
import worker from '../src/worker.js';

test('default server is deployed Rust API', () => {
  assert.equal(parseArgs([]).apiUrl, 'https://stock-market-api.auenkr.com');
});

test('Node MCP discovers and calls tools without credentials', async () => {
  let requestPath = '';
  const api = createServer((req, res) => {
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers.authorization, undefined);
    requestPath = req.url!;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ symbol: '/company/RELIANCE/' }] }));
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${(api.address() as {port:number}).port}`;
  const server = await startServer(0, '127.0.0.1', apiUrl);
  const client = new Client({ name:'test', version:'1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`)));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 14);
    assert.ok(tools.every(tool => !('securitySchemes' in tool)));
    const result = await client.callTool({ name:'search_companies', arguments:{q:'reliance'} });
    assert.equal(result.isError, undefined);
    assert.equal(requestPath, '/v1/company-search?q=reliance');
    await client.callTool({ name:'screen_companies', arguments:{query:'Market Capitalization > 500'} });
    assert.equal(new URL(requestPath, apiUrl).searchParams.get('query'), 'Market Capitalization > 500');
  } finally {
    await client.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => api.close(() => resolve()));
  }
});

test('Worker MCP lists tools without OAuth', async () => {
  const response = await worker.fetch(new Request('https://mcp.example/mcp', {
    method:'POST', headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})
  }), {});
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /screen_companies/);
  assert.doesNotMatch(text, /oauth2/);
  assert.equal((await worker.fetch(new Request('https://mcp.example/.well-known/oauth-protected-resource'), {})).status, 404);
});
