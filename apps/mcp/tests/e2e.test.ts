import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/index.js";

const webUrl = process.env.WEB_URL ?? "http://localhost:3000";
const apiUrl = process.env.STOCK_MARKET_API_URL ?? "http://localhost:3002";
const email = process.env.DEV_EMAIL ?? "dev@auenkr.com";
const password = process.env.DEV_PASSWORD ?? "test-development-password";

async function devStackReady() {
  try {
    const [web, api] = await Promise.all([fetch(`${webUrl}/api/auth/ok`).catch(() => undefined), fetch(`${apiUrl}/health`)]);
    return Boolean(web?.ok || web?.status === 400 || web?.status === 404) && Boolean(api?.ok);
  } catch {
    return false;
  }
}

let mcpPort = 0;
let mcp: Awaited<ReturnType<typeof startServer>>;

after(async () => {
  mcp?.close();
});

test("e2e: dev stack through MCP tools", { timeout: 120000 }, async (t) => {
  if (!(await devStackReady())) {
    assert.fail(`dev web (${webUrl}) and api (${apiUrl}) must be running for e2e tests`);
  }
  const login = await fetch(`${webUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: webUrl },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, "dev login failed");
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const created = await fetch(`${webUrl}/api/keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: webUrl },
    body: JSON.stringify({ name: "mcp-e2e", expiration: "never" }),
  });
  assert.equal(created.status, 201, "key creation failed");
  const { key } = (await created.json()) as { key: string };
  try {
    mcp = await startServer(0, "127.0.0.1", apiUrl);
    mcpPort = (mcp.address() as { port: number }).port;
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 13);
    const search = await client.callTool({ name: "search_companies", arguments: { q: "reliance" } });
    assert.equal(search.isError, undefined);
    assert.match((search.content as { text: string }[])[0]!.text, /RELIANCE|reliance/);
    const profile = await client.callTool({ name: "company_profile", arguments: { symbol: "/company/RELIANCE/consolidated/" } });
    assert.equal(profile.isError, undefined);
    assert.match((profile.content as { text: string }[])[0]!.text, /Reliance/);
    const denied = await client.callTool({ name: "profit_loss", arguments: { symbol: "/company/RELIANCE/consolidated/" } });
    if (denied.isError) assert.match((denied.content as { text: string }[])[0]!.text, /403|required|plan/i);
    await client.close();
  } finally {
    // The dev key is a disposable test credential; deleting is optional and not exposed publicly.
  }
});
