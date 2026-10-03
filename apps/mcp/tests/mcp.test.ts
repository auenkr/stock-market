import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer, parseArgs } from "../src/index.js";

let api: Server;
let apiPort: number;
let mcpPort: number;
let lastUpstreamAuth: string | undefined;
let lastUpstreamUrl: string | undefined;

before(async () => {
  api = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    lastUpstreamAuth = req.headers["x-api-key"] as string | undefined;
    lastUpstreamUrl = url.pathname + url.search;
    if (url.pathname === "/v1/company-search") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ name: "Reliance Industries", symbol: "/company/RELIANCE/consolidated/" }] }));
      return;
    }
    if (url.pathname === "/api/v1/company-profile") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "Reliance Industries" }));
      return;
    }
    if (url.pathname === "/api/v1/profit-loss") {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Paid plan required", code: "PAID_PLAN_REQUIRED" }));
      return;
    }
    if (url.pathname === "/api/v1/balance-sheet") {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad request");
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiPort = (api.address() as { port: number }).port;
  const mcp = await startServer(0, "127.0.0.1", `http://127.0.0.1:${apiPort}`);
  mcpPort = (mcp.address() as { port: number }).port;
  (globalThis as Record<string, unknown>).__mcp = mcp;
});

after(async () => {
  api.close();
  ((globalThis as Record<string, unknown>).__mcp as Server).close();
});

async function mcpClient(headers: Record<string, string>) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return client;
}

test("cli parses help and ports", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--port", "9000"]).port, 9000);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
});

test("lists public tools only", async () => {
  const client = await mcpClient({ "X-API-Key": "test-key" });
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("company_profile"));
  assert.ok(names.includes("search_companies"));
  assert.equal(names.some((n) => /internal|dividend|corporate|ownership|results|ipo|extract/.test(n)), false);
  await client.close();
});

test("forwards API key and query params", async () => {
  const client = await mcpClient({ Authorization: "Bearer bearer-key" });
  const result = await client.callTool({ name: "search_companies", arguments: { q: "reliance" } });
  assert.equal(lastUpstreamAuth, "bearer-key");
  assert.equal(lastUpstreamUrl, "/v1/company-search?q=reliance");
  assert.match((result.content as { text: string }[])[0]!.text, /Reliance Industries/);
  await client.close();
});

test("maps upstream errors to short messages", async () => {
  const client = await mcpClient({ "X-API-Key": "test-key" });
  const denied = await client.callTool({ name: "profit_loss", arguments: { symbol: "/company/RELIANCE/consolidated/" } });
  assert.equal(denied.isError, true);
  assert.match((denied.content as { text: string }[])[0]!.text, /Paid plan required \(403\)/);
  const invalid = await client.callTool({ name: "balance_sheet", arguments: { symbol: "/company/RELIANCE/consolidated/" } });
  assert.equal(invalid.isError, true);
  assert.match((invalid.content as { text: string }[])[0]!.text, /Invalid API response \(400\)/);
  await client.close();
});

test("rejects missing API key with 401", async () => {
  const response = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "API key required" });
});
