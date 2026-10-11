import assert from 'node:assert/strict';
const [mcp, api] = process.argv.slice(2);
assert.ok(mcp, 'Provide MCP URL and optionally an API URL after manually updating its container');
const health = await fetch(new URL('/health', mcp), {signal:AbortSignal.timeout(30000)});
assert.equal(health.status,200);
const tools = await fetch(mcp,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),signal:AbortSignal.timeout(30000)});
assert.equal(tools.status,200);
const text = await tools.text();
assert.match(text,/screen_companies/);
assert.doesNotMatch(text,/oauth2/);
console.log('Anonymous hosted MCP health and tool discovery passed');
if (api) {
 const response = await fetch(`${api}/v1/company-search?q=reliance`, {signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,await response.text());
 console.log('Anonymous Rust API search passed');
}
