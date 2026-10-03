import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, DEFAULT_API_URL, extractApiKey } from "./shared.js";

export interface Env {
  STOCK_MARKET_API_URL?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json(200, { ok: true });
    if (url.pathname !== "/mcp" || request.method !== "POST") return json(404, { error: "Not found" });
    const apiKey = extractApiKey(request.headers);
    if (!apiKey) return json(401, { error: "API key required" });
    const apiUrl = (env.STOCK_MARKET_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
    const mcp = createMcpServer(apiUrl, apiKey);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      return await transport.handleRequest(request, {
        authInfo: { token: apiKey, clientId: "api-key", scopes: [] },
      });
    } catch {
      return json(500, { error: "MCP request failed" });
    }
  },
};
