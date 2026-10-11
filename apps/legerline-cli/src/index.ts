import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentTools, type AgentTool } from "@stock-market/agent-tools";
import { spec } from "./catalog.js";

const DEFAULT_API_URL = "https://stock-market-api.auenkr.com";
const tools = agentTools(spec as unknown as Parameters<typeof agentTools>[0]);
const toolByName = new Map(tools.map(t => [t.name, t]));

type Config = { apiUrl?: string };

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), ".config"), "legerline");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function loadConfig(): Config {
  try {
    if (!existsSync(configPath())) return {};
    const parsed = JSON.parse(readFileSync(configPath(), "utf8"));
    return typeof parsed === "object" && parsed ? { apiUrl: parsed.apiUrl } : {};
  } catch {
    fail(`Cannot parse ${configPath()}. Fix or delete it.`);
  }
}

function saveConfig(config: Config): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(configPath(), 0o600); } catch {}
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function helpText(): string {
  return `legerline — CLI for the Legerline stock market API (Indian company financials)

USAGE
  legerline <tool> [--param value ...]
  legerline <command>

COMMANDS
  set-api-url <url>   Save API base URL
  config              Show current API URL
  tools               List available tools
  help                Show this help

TOOLS
${tools.map(t => `  ${t.name.padEnd(38)} ${t.title}`).join("\n")}

OPTIONS
  --api-url <url>     Override API base URL
  --<param> <value>   Tool parameter (see: legerline tools)

ENVIRONMENT
  LEGERLINE_API_URL   API base URL (overrides saved config)

OUTPUT
  JSON on stdout. Errors on stderr with non-zero exit code.

EXAMPLES
  legerline get_v1_company_search --q reliance
  legerline get_api_v1_company_profile --symbol /company/RELIANCE/consolidated/
`;
}

function getApiUrl(config: Config, override?: string): string {
  return (override ?? process.env.LEGERLINE_API_URL ?? config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
}

async function callApi(tool: AgentTool, params: Record<string, string>, apiUrl: string): Promise<unknown> {
  const url = new URL(apiUrl + tool.path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  } catch {
    fail(`Cannot reach API at ${apiUrl}`);
  }
  const text = await response.text();
  if (response.ok) {
    try { return JSON.parse(text); } catch { return text; }
  }
  let code = "";
  try { code = JSON.parse(text)?.code ?? ""; } catch {}
  switch (response.status) {
    case 401: fail("Upstream access denied."); break;
    case 402:
    case 403: fail("Upstream access denied."); break;
    case 404: fail("Not found."); break;
    case 429: fail("Rate limit exceeded. Retry later."); break;
    case 501: fail("Dataset unavailable for this source."); break;
    default: fail(`Request failed (HTTP ${response.status})${code ? `: ${code}` : ""}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "";
  const positional: string[] = [];
  const options: Record<string, string> = {};
  let help = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) fail(`Option ${arg} needs a value.`);
      options[arg.slice(2)] = value; i++;
    } else positional.push(arg);
  }

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(helpText());
    return;
  }
  const config = loadConfig();

  if (command === "set-api-url") {
    const url = positional[0]?.trim();
    if (!url) fail("Usage: legerline set-api-url <url>");
    saveConfig({ ...config, apiUrl: url.replace(/\/+$/, "") });
    console.log(`Saved API URL to ${configPath()}`);
    return;
  }
  if (command === "config") {
    console.log(JSON.stringify({
      configPath: configPath(),
      apiUrl: getApiUrl(config, options["api-url"]),
    }, null, 2));
    return;
  }
  if (command === "tools") {
    if (help) { console.log("List available tools. Usage: legerline tools"); return; }
    for (const t of tools) console.log(`${t.name}\t${t.tier}\t${t.title}`);
    return;
  }

  if (positional.length > 0) fail(`Unexpected argument: ${positional[0]}`);
  const tool = toolByName.get(command);
  if (!tool) fail(`Unknown command: ${command}. Run: legerline --help`);
  if (help) {
    console.log(`${tool.name} — ${tool.title}\n\n${tool.description}\n\nParameters:\n${tool.parameters.map(p => `  --${p.name}${p.required ? " (required)" : ""}  ${p.description ?? ""}`).join("\n")}`);
    return;
  }
  const apiUrl = getApiUrl(config, options["api-url"]);
  delete options["api-url"];
  const params: Record<string, string> = {};
  for (const p of tool.parameters) {
    const value = options[p.name];
    if (value === undefined) {
      if (p.required) fail(`Missing --${p.name}. Example: legerline ${tool.name} --${p.name} <value>`);
      continue;
    }
    params[p.name] = value;
    delete options[p.name];
  }
  for (const key of Object.keys(options)) fail(`Unknown option --${key}`);
  console.log(JSON.stringify(await callApi(tool, params, apiUrl), null, 2));
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)));
