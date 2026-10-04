import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/worker.js";
import { resolveOAuthAccess } from "../src/oauth.js";

const url = "https://stock-market-mcp.auenkr.com/mcp";

test("unauthenticated MCP GET and POST advertise OAuth discovery", async () => {
  for (const method of ["GET", "POST"]) {
    const response = await worker.fetch(new Request(url, { method }), {});
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
  }
});

test("authenticated GET reaches the stateless MCP transport", async () => {
  const response = await worker.fetch(new Request(url, {
    headers: { Authorization: "Bearer sm_live_test", Accept: "text/event-stream" },
  }), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  await response.body?.cancel();
});

test("authenticated unsupported methods advertise POST and GET", async () => {
  const response = await worker.fetch(new Request(url, {
    method: "DELETE", headers: { Authorization: "Bearer sm_live_test" },
  }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, GET");
});

test("OAuth account requests do not follow redirects with bearer tokens", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.equal(init.redirect, "manual");
    return new Response(null, { status: 307, headers: { Location: "https://other.example/access" } });
  });
  await assert.rejects(resolveOAuthAccess("test-token", {
    MCP_ACCOUNT_SERVICE_SECRET: "test-account-service-secret-32-characters",
  }), /MCP account service unavailable/);
});

test("OAuth account signatures preserve the exact configured secret bytes", async (t) => {
  const secret = "test-account-service-secret-32-characters\n";
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const signature = createHmac("sha256", secret)
      .update(`${headers.get("X-MCP-Timestamp")}.${init.body}`).digest("hex");
    assert.equal(headers.get("X-MCP-Signature"), signature);
    return Response.json({ apiKey: "sm_live_test", clientId: "test-client", scopes: ["market:read"] });
  });
  assert.deepEqual(await resolveOAuthAccess("test-token", { MCP_ACCOUNT_SERVICE_SECRET: secret }), {
    apiKey: "sm_live_test", clientId: "test-client", scopes: ["market:read"],
  });
});
