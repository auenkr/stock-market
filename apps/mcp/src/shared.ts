import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const DEFAULT_API_URL = "http://localhost:8787";

export type AuthShape = { token: string; clientId: string; scopes: string[] };

type ToolDef = {
  name: string;
  description: string;
  path: string;
  schema: z.ZodRawShape;
  params: (input: Record<string, unknown>) => Record<string, string | number | undefined>;
};

const symbolOnly = { symbol: z.string().min(1).describe("Company identifier from search, e.g. /company/RELIANCE/consolidated/") };

const tools: ToolDef[] = [
  {
    name: "search_companies",
    description: "Search companies by name. Returns symbol values to pass to other tools.",
    path: "/v1/company-search",
    schema: { q: z.string().min(1).describe("Company name query") },
    params: (a) => ({ q: String(a.q) }),
  },
  {
    name: "list_companies",
    description: "List companies, 100 per page.",
    path: "/v1/list-of-company",
    schema: { page: z.number().int().min(1).optional().describe("One-based page number") },
    params: (a) => ({ page: typeof a.page === "number" ? a.page : undefined }),
  },
  {
    name: "company_profile",
    description: "Company profile: description, website, exchanges, classification, market cap.",
    path: "/api/v1/company-profile",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "basic_financials",
    description: "Basic finance summary, business description, key points, price data, pros/cons.",
    path: "/api/v1/basic-financials",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "company_documents",
    description: "Company documents: annual reports, announcements, ratings, transcripts, presentations.",
    path: "/api/v1/company-documents",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "peer_comparison",
    description: "Peer comparison rows: price, P/E, market cap, dividend yield, sales, profit, growth, ROCE.",
    path: "/api/v1/peer-comparison",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "quarterly_profit_loss",
    description: "Quarterly profit and loss results.",
    path: "/api/v1/quarterly-profit-loss",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "profit_loss",
    description: "Annual profit and loss and available TTM results.",
    path: "/api/v1/profit-loss",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "balance_sheet",
    description: "Annual balance sheets and detailed schedules.",
    path: "/api/v1/balance-sheet",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "cash_flow",
    description: "Annual operating, investing, and financing cash flows.",
    path: "/api/v1/cash-flow",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "ratios",
    description: "Profitability ratios and reported historical ratio table.",
    path: "/api/v1/ratios",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "shareholding_pattern",
    description: "Quarterly ownership percentages for categories and disclosed holders.",
    path: "/api/v1/shareholding-pattern",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
  {
    name: "shareholding_distribution",
    description: "Quarterly ownership categories and percentages by reporting period.",
    path: "/api/v1/shareholdings/distribution",
    schema: symbolOnly,
    params: (a) => ({ symbol: String(a.symbol) }),
  },
];

export function extractApiKey(headers: Headers): string | undefined {
  const header = headers.get("x-api-key");
  if (header?.trim()) return header.trim();
  const auth = headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

export async function callApi(apiUrl: string, apiKey: string, path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(path, apiUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url, { headers: { "X-API-Key": apiKey, accept: "application/json" } });
  } catch {
    throw new Error("API unreachable");
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Invalid API response (${response.status})`);
  }
  if (!response.ok) {
    const message = (body as { error?: string })?.error;
    throw new Error(message ? `${message} (${response.status})` : `API error ${response.status}`);
  }
  return body;
}

export function createMcpServer(apiUrl: string, apiKey: string, oauth = false): McpServer {
  const server = new McpServer({ name: "stock-market", version: "1.0.0" }, {
    instructions: "Ledgerline provides Indian company fundamentals and reported financial data. Search or list companies first, then pass the returned symbol unchanged to company tools. Access depends on the connected account's plan and shared request allowance. Report unavailable data and access errors accurately; do not infer missing figures. These tools do not execute trades or payments.",
  });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        ...(oauth ? { securitySchemes: [{ type: "oauth2", scopes: ["market:read"] }], _meta: { securitySchemes: [{ type: "oauth2", scopes: ["market:read"] }] } } : {}),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          const data = await callApi(apiUrl, apiKey, tool.path, tool.params(args as Record<string, unknown>));
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return { isError: true, content: [{ type: "text" as const, text: message }] };
        }
      },
    );
  }
  return server;
}
