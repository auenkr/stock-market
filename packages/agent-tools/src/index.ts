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
  schema?: { type?: string; enum?: readonly string[]; description?: string; maxLength?: number };
};

export type AgentTool = {
  /** Stable tool name shared by ChatGPT operationId, MCP tool name, and CLI subcommand. */
  name: string;
  title: string;
  description: string;
  method: "GET";
  path: string;
  tier: "free";
  category: string;
  parameters: AgentToolParameter[];
};

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: AgentToolParameter[];
  "x-tier"?: "free";
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
    tier: operation["x-tier"] ?? "free",
    category: operation.tags?.[0] ?? "General",
    parameters: operation.parameters ?? [],
  }));
}
