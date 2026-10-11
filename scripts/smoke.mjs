import assert from 'node:assert/strict';
const [api, mcp] = process.argv.slice(2);
assert.ok(api && mcp, 'Provide API URL and MCP URL');
const response = await fetch(`${api}/v1/company-search?q=reliance`, {signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200,await response.text());
const tools = await fetch(mcp,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),signal:AbortSignal.timeout(30000)});
assert.equal(tools.status,200);
assert.match(await tools.text(),/screen_companies/);
console.log('Public API and MCP smoke passed');
