import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, DEFAULT_API_URL, extractApiKey, type AuthShape } from "./shared.js";

export function parseArgs(argv: string[]): { port: number; host: string; apiUrl: string; help: boolean } {
  const options = {
    port: Number(process.env.MCP_PORT ?? 8788),
    host: process.env.MCP_HOST ?? "127.0.0.1",
    apiUrl: (process.env.STOCK_MARKET_API_URL ?? DEFAULT_API_URL).replace(/\/$/, ""),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--port":
        options.port = Number(argv[++i]);
        break;
      case "--host":
        options.host = String(argv[++i]);
        break;
      case "--api-url":
        options.apiUrl = String(argv[++i]).replace(/\/$/, "");
        break;
      default:
        throw new Error(`Unknown option: ${arg}. See --help.`);
    }
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) throw new Error("Invalid --port");
  return options;
}

function help(): string {
  return `legerline-mcp — MCP server for the Stock Market API (stateless HTTP)

Usage:
  legerline-mcp [--port <n>] [--host <h>] [--api-url <url>]

Options:
  --port <n>      Port to listen on (default: 8788, env: MCP_PORT)
  --host <h>      Host to bind (default: 127.0.0.1, env: MCP_HOST)
  --api-url <url> Stock Market API base URL (default: ${DEFAULT_API_URL}, env: STOCK_MARKET_API_URL)
  -h, --help      Show this help

Auth:
  Send the same dashboard API key as the REST API via
  'Authorization: Bearer <key>' or 'X-API-Key: <key>'.

Endpoints:
  POST /mcp       MCP streamable HTTP endpoint (stateless)
  GET  /health    Liveness probe
`;
}

export function startServer(port: number, host: string, apiUrl: string) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname !== "/mcp" || req.method !== "POST") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const apiKey = extractApiKey(headers);
    if (!apiKey) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "API key required" }));
      return;
    }
    const mcp = createMcpServer(apiUrl, apiKey);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    (req as IncomingMessage & { auth?: AuthShape }).auth = { token: apiKey, clientId: "api-key", scopes: [] };
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "MCP request failed" }));
      }
    } finally {
      await transport.close().catch(() => undefined);
      await mcp.close().catch(() => undefined);
    }
  });
  return new Promise<typeof server>((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(help());
      return;
    }
    const server = await startServer(options.port, options.host, options.apiUrl);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    console.log(`legerline-mcp listening on http://${options.host}:${port}/mcp (API: ${options.apiUrl})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Startup failed");
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) await main();
