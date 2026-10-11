import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, DEFAULT_API_URL } from "./shared.js";

export interface Env {
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
    if (url.pathname !== "/mcp") return Response.json({ error: "Not found" }, { status: 404 });
    if (request.method !== "POST" && request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "POST, GET" } });
    const apiUrl = (env.STOCK_MARKET_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
    const mcp = createMcpServer(apiUrl);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      return await transport.handleRequest(request);
    } catch {
      return Response.json({ error: "MCP request failed" }, { status: 500 });
    }
  },
};
