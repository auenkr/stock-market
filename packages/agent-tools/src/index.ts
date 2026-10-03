/**
 * Shared agent-facing tool contract. ChatGPT Actions, the upcoming MCP server,
 * and the agent CLI all expose exactly these tools, derived from the same
 * OpenAPI document that public /openapi.json serves. Internal and service
 * endpoints are never exposed to agents.
 */

export type AgentToolParameter = {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  schema?: { type?: string; enum?: readonly string[]; description?: string };
};

export type AgentTool = {
  /** Stable tool name shared by ChatGPT operationId, MCP tool name, and CLI subcommand. */
  name: string;
  title: string;
  description: string;
  method: "GET";
  path: string;
  tier: "free" | "paid";
  category: string;
  parameters: AgentToolParameter[];
};

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: AgentToolParameter[];
  "x-tier"?: "free" | "paid";
  "x-api-style"?: string;
  "x-use-case"?: string;
  "x-alias"?: boolean;
  tags?: string[];
};

type Spec = {
  "x-access-policy"?: unknown;
  paths: Record<string, { get?: Operation } | undefined> | undefined;
  tags?: { name: string; description?: string }[];
  components?: { securitySchemes?: unknown };
  servers?: { url: string; description?: string }[];
  info?: Record<string, unknown>;
};

function keptOperations(spec: Spec): Array<{ path: string; operation: Operation }> {
  const out: Array<{ path: string; operation: Operation }> = [];
  for (const [path, entry] of Object.entries(spec.paths ?? {})) {
    const operation = (entry as { get?: Operation } | undefined)?.get;
    if (!operation) continue;
    if (operation["x-use-case"] === "internal") continue;
    if (operation["x-alias"]) continue;
    if (operation["x-api-style"] === "service") continue;
    out.push({ path, operation });
  }
  return out;
}

/** Tools exposed to ChatGPT, MCP, and CLI. Internal API endpoints are excluded by construction. */
export function agentTools(spec: Spec): AgentTool[] {
  return keptOperations(spec).map(({ path, operation }) => ({
    name: operation.operationId!,
    title: operation.summary ?? operation.operationId!,
    description: operation.description ?? operation.summary ?? "",
    method: "GET",
    path,
    tier: operation["x-tier"] ?? "paid",
    category: operation.tags?.[0] ?? "General",
    parameters: operation.parameters ?? [],
  }));
}

/** OpenAPI document restricted to the agent tool surface, ready for ChatGPT Actions. */
export function agentOpenApi(spec: Spec, info: { title: string; version: string; description: string }) {
  const paths: Record<string, unknown> = {};
  const categories = new Set<string>();
  for (const { path, operation } of keptOperations(spec)) {
    paths[path] = { get: operation };
    for (const tag of operation.tags ?? []) categories.add(tag);
  }
  return {
    openapi: "3.0.3",
    info: { ...info, contact: { name: "Stock Market API", url: "https://stock-market-api.auenkr.com" } },
    servers: spec.servers,
    "x-access-policy": spec["x-access-policy"],
    security: [{ apiKey: [] }],
    tags: (spec.tags ?? []).filter((tag) => categories.has(tag.name)),
    paths,
    components: spec.components,
  };
}

/** ChatGPT plugin manifest (/.well-known/ai-plugin.json). Mirrors agentOpenApi. */
export function agentPluginManifest(origin: string, tools: AgentTool[]) {
  return {
    schema_version: "v1",
    name_for_human: "Ledgerline Stock Market API",
    name_for_model: "stock_market_api",
    description_for_human: "Indian company research for AI tools. Hobby is free, no card. Basic ₹199/month; Personal ₹399/month; Professional ₹2,499/month. Data availability varies.",
    description_for_model:
      "Use these tools to research Indian listed companies. Always call get_v1_company_search (or get_v1_list_of_company) first and pass the returned symbol unchanged to company endpoints. " +
      "symbol values are URL paths like /company/RELIANCE/consolidated/. Amounts are INR rupees; statement values may be null when unavailable. Hobby is free without a credit card (10 requests/minute) and supports free endpoints for RELIANCE, HDFCBANK, BHARTIARTL, ICICIBANK, and SBIN. " +
      "Basic costs INR 199/month (60/minute) and supports all companies on free endpoints. Detailed statements, documents, ratios and shareholding require Personal at INR 399/month (300/minute) or Professional at INR 2499/month (500/minute). Only Professional permits commercial use. " +
      "The same account, key and shared rate allowance cover REST, ChatGPT and MCP. On PAID_PLAN_REQUIRED recommend Personal or Professional, not Basic. On FREE_COMPANY_RESTRICTED recommend Basic or higher. " +
      "Never invent symbols; report null fields as unavailable rather than guessing.",
    auth: { type: "api_key", in: "header", name: "X-API-Key" },
    api: { type: "openapi", url: `${origin}/plugin/openapi.json` },
    contact_email: "support@auenkr.com",
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
  };
}
