import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, DEFAULT_API_URL } from "./shared.js";
import { authorizationRequired, oauthConfiguration, resolveOAuthAccess, MCP_SCOPE, type OAuthEnv } from "./oauth.js";

export interface Env extends OAuthEnv {
  STOCK_MARKET_API_URL?: string;
  OPENAI_APPS_CHALLENGE?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/.well-known/openai-apps-challenge" && request.method === "GET" && env.OPENAI_APPS_CHALLENGE) {
      return new Response(env.OPENAI_APPS_CHALLENGE, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    if (["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(url.pathname) && request.method === "GET") {
      const { resource, issuer } = oauthConfiguration(env);
      return Response.json({ resource, authorization_servers: [issuer], scopes_supported: [MCP_SCOPE, "offline_access"], bearer_methods_supported: ["header"], resource_name: "Ledgerline", resource_documentation: `${new URL(issuer).origin}/docs` });
    }
    if (url.pathname !== "/mcp") return Response.json({ error: "Not found" }, { status: 404 });
    const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const legacyKey = request.headers.get("X-API-Key") || (bearer?.startsWith("sm_live_") ? bearer : undefined);
    let access;
    try { access = legacyKey ? { apiKey: legacyKey, clientId: "api-key", scopes: [] } : bearer ? await resolveOAuthAccess(bearer, env) : null; }
    catch { return Response.json({ error: "Account connection unavailable" }, { status: 503 }); }
    if (!access) return authorizationRequired(env);
    if (request.method !== "POST" && request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "POST, GET" } });
    const apiUrl = (env.STOCK_MARKET_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
    const mcp = createMcpServer(apiUrl, access.apiKey, true);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      return await transport.handleRequest(request, { authInfo: { token: bearer || access.apiKey, clientId: access.clientId, scopes: access.scopes } });
    } catch {
      return Response.json({ error: "MCP request failed" }, { status: 500 });
    }
  },
};
