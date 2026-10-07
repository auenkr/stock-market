"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import "./reference.css";
import { ThemePicker } from "../../components/theme-picker";
import { Download, ExternalLink, Send } from "lucide-react";
import Fuse from "fuse.js";
import { OptionSelect } from "../../components/option-select";
import { CopyButton } from "../../components/copy-button";
import { ScreeningRatioGallery } from "./screening-ratio-gallery";

type Schema = { $ref?: string; type?: string; nullable?: boolean; description?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; additionalProperties?: boolean | Schema; enum?: string[]; format?: string; oneOf?: Schema[]; anyOf?: Schema[]; example?: unknown; minimum?: number; maxItems?: number };
type Parameter = { name: string; in: string; required?: boolean; description?: string; schema: Schema; example?: unknown };
type ApiResponse = { description: string; content?: Record<string, { schema: Schema }>; headers?: Record<string, { description?: string; schema: Schema }> };
type Operation = { operationId: string; summary: string; description?: string; tags?: string[]; parameters?: Parameter[]; responses: Record<string, ApiResponse>; "x-tier"?: "free" | "paid"; "x-api-style"?: string; "x-coverage"?: string; "x-alias"?: boolean; "x-resource"?: string; "x-canonical-path"?: string; "x-timeout-ms"?: number; "x-use-case": string; "x-order": number };
type JourneyGroup = { id: string; title: string; description: string; order: number };
export type ApiSpec = { openapi: string; info: { title: string; version: string; description: string }; servers: { url: string }[]; paths: Record<string, { get?: Operation }>; components: { schemas: Record<string, Schema> }; "x-user-journey": JourneyGroup[]; "x-coverage-summary": { total: number; partial: number; unavailable: number; excluded: number; inspectedAt: string }; "x-data-conventions": string[] };
type Entry = { path: string; operation: Operation; aliases: string[] };
type RequestOutput = { status: string; text: string; requestUrl: string; ok?: boolean; duration?: number; headers?: [string, string][] };
type OperationWorkspace = { values: Record<string, string>; tab: string; status: string; output: RequestOutput | null; busy: boolean; hasRequested: boolean; language: string };

function initialWorkspace(operation: Operation): OperationWorkspace {
  return {
    values: Object.fromEntries((operation.parameters ?? []).map((p) => [p.name, p.required || p.name === "symbol" ? (Array.isArray(p.example) ? p.example.join(",") : String(p.example ?? p.schema.enum?.[0] ?? "")) : ""])),
    tab: "request", status: Object.keys(operation.responses)[0]!, output: null, busy: false, hasRequested: false, language: "curl",
  };
}

function resolve(schema: Schema, spec: ApiSpec): Schema {
  return schema.$ref ? spec.components.schemas[schema.$ref.split("/").at(-1)!] ?? schema : schema;
}
function example(schema: Schema, spec: ApiSpec, depth = 0): unknown {
  const s = resolve(schema, spec);
  if (depth > 7) return null;
  if (s.example !== undefined) return s.example;
  if (s.nullable) return null;
  const variants = s.oneOf ?? s.anyOf;
  if (variants?.length) return example(variants[0]!, spec, depth + 1);
  if (s.enum?.length) return s.enum[0];
  if (s.type === "array") return s.maxItems === 0 ? [] : [example(s.items ?? {}, spec, depth + 1)];
  if (s.type === "object") return s.properties ? Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, example(v, spec, depth + 1)])) : typeof s.additionalProperties === "object" ? { "<dynamic key>": example(s.additionalProperties, spec, depth + 1) } : {};
  if (s.type === "number" || s.type === "integer") return 0;
  if (s.type === "boolean") return false;
  return s.type === "string" ? (s.format === "date" ? "2026-10-01" : "string") : null;
}
function typeLabel(s: Schema): string {
  return s.$ref?.split("/").at(-1) ?? (s.oneOf ? "one of" : s.anyOf ? "any of" : s.type === "array" ? `array<${typeLabel(s.items ?? {})}>` : s.type ?? "any");
}
function SchemaTree({ schema, spec, depth = 0 }: { schema: Schema; spec: ApiSpec; depth?: number }) {
  const s = resolve(schema, spec);
  if (depth > 7) return <code>See referenced schema</code>;
  const variants = s.oneOf ?? s.anyOf;
  if (variants) return <div className="schema-variants">{variants.map((v, i) => <details key={i} open={i === 0}><summary>Variant {i + 1} · {typeLabel(v)}</summary><SchemaTree schema={v} spec={spec} depth={depth + 1} /></details>)}</div>;
  if (s.type === "array") return <div className="schema-array"><span className="schema-type">array items</span><SchemaTree schema={s.items ?? {}} spec={spec} depth={depth + 1} /></div>;
  if (s.type !== "object") return <div className="schema-leaf"><code>{typeLabel(s)}</code>{s.nullable && <span>nullable</span>}{s.description && <p>{s.description}</p>}</div>;
  return <div className="schema-tree">{Object.entries(s.properties ?? {}).map(([name, field]) => {
    const value = resolve(field, spec); const nested = Boolean(value.properties || value.items || value.oneOf || value.anyOf);
    const label = <><code>{name}</code><span className="schema-type">{typeLabel(field)}{value.nullable ? " · nullable" : ""}</span>{s.required?.includes(name) && <span className="schema-required">required</span>}</>;
    return nested ? <details key={name} open={depth < 1}><summary>{label}</summary><SchemaTree schema={field} spec={spec} depth={depth + 1} /></details> : <div className="schema-field" key={name}>{label}{value.description && <p>{value.description}</p>}</div>;
  })}{s.additionalProperties && <div className="schema-field"><code>[dynamic key]</code><span className="schema-type">{typeof s.additionalProperties === "object" ? typeLabel(s.additionalProperties) : "any"}</span>{typeof s.additionalProperties === "object" && <SchemaTree schema={s.additionalProperties} spec={spec} depth={depth + 1} />}</div>}{!s.properties && !s.additionalProperties && <p className="subtle">Object; this legacy or service schema is not constrained further.</p>}</div>;
}

export function ApiExplorer({ spec, initialServer }: { spec: ApiSpec; initialServer: string }) {
  const entries = useMemo(() => Object.entries(spec.paths).flatMap(([path, item]) => item.get && !item.get["x-alias"] ? [{ path, operation: item.get, aliases: Object.entries(spec.paths).filter(([, alias]) => alias.get?.["x-alias"] && alias.get["x-canonical-path"] === path).map(([alias]) => alias) }] : []).sort((a, b) => a.operation["x-order"] - b.operation["x-order"]), [spec]);
  const [search, setSearch] = useState(""); const [tier, setTier] = useState("all"); const [useCase, setUseCase] = useState("all");
  const [selected, setSelected] = useState("/v1/company-search"); const [server, setServer] = useState(initialServer);
  const [apiKey, setApiKey] = useState("");
  // Keep endpoint workspaces above the keyed panel so navigation cannot discard them.
  const [workspaces, setWorkspaces] = useState<Record<string, OperationWorkspace>>({});
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const pending = controllers.current;
    return () => { for (const controller of pending.values()) controller.abort(); pending.clear(); };
  }, []);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sync = () => { const endpoint = new URLSearchParams(location.hash.slice(1)).get("endpoint"); if (endpoint && entries.some((entry) => entry.path === endpoint)) setSelected(endpoint); };
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); searchInput.current?.focus(); } };
    sync(); window.addEventListener("hashchange", sync); window.addEventListener("keydown", shortcut);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("keydown", shortcut); };
  }, [entries]);
  const searchIndex = useMemo(() => new Fuse(entries, {
    keys: [{ name: "operation.summary", weight: 0.4 }, { name: "path", weight: 0.3 }, { name: "aliases", weight: 0.15 }, { name: "operation.description", weight: 0.1 }, { name: "operation.tags", weight: 0.05 }],
    threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2,
  }), [entries]);
  const matches = search.trim() ? searchIndex.search(search.trim()).map(({ item }) => item) : entries;
  const filtered = matches.filter(({ operation: op }) => (tier === "all" || op["x-tier"] === tier) && (useCase === "all" || op["x-use-case"] === useCase)).sort((a, b) => a.operation["x-order"] - b.operation["x-order"]);
  const active = filtered.find((e) => e.path === selected) ?? filtered[0] ?? entries.find((e) => e.path === selected) ?? entries[0]!; const counts = spec["x-coverage-summary"];
  return <div className="docs reference-page">
    <header className="reference-topbar"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline<span className="reference-divider">/</span><span className="reference-caption">API reference</span></Link><div className="docs-actions"><ThemePicker /><Link className="button secondary" href="/documentation">Documentation</Link><a className="button secondary" href="/swagger.json" download="swagger_ledgerline.json">OpenAPI <Download size={14} aria-hidden="true" /></a><Link className="button" href="/dashboard">Dashboard <ExternalLink size={14} aria-hidden="true" /></Link></div></header>
    <section className="reference-hero"><div><span className="eyebrow">DEVELOPER DOCUMENTATION · v{spec.info.version}</span><h1>API reference</h1><p className="subtle">Search → Company overview → Finance.{spec["x-user-journey"].some((group) => group.id === "internal") && " Supplementary endpoints are grouped under Internal."}</p></div><a className="reference-contract" href="/swagger.json">OpenAPI {spec.openapi} <ExternalLink size={14} aria-hidden="true" /></a></section>
    <section className="connection-bar" aria-label="API connection"><label>Base URL<input className="input mono" aria-label="API server" value={server} onChange={(e) => setServer(e.target.value)} spellCheck={false} /></label><label>API key<input className="input mono" type="password" autoComplete="off" aria-label="API key" placeholder="Paste your API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /><small>Sent as X-API-Key. Kept in memory for this page only.</small></label><Link href="/dashboard/keys">Get Key <ExternalLink size={14} aria-hidden="true" /></Link></section>
    <div className="reference-notice"><span className="pill">Coverage</span><p>Partial responses may contain <code>null</code> values. Endpoints marked “Source gap” return <code>501</code>.</p><a href="#conventions">Data conventions ↓</a></div>
    <div className="reference-layout">
      <aside className="reference-nav">
        <label className="search-label" htmlFor="endpoint-search">Endpoints <kbd>⌘ / Ctrl K</kbd></label>
        <input ref={searchInput} id="endpoint-search" className="input" type="search" placeholder="Search endpoints…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="reference-filters">
          <label>Use case<OptionSelect label="Filter endpoint use case" value={useCase} onChange={setUseCase} options={[{ value: "all", label: "All use cases" }, ...spec["x-user-journey"].map((group) => ({ value: group.id, label: `${group.order}. ${group.title}` }))]} /></label>
          <label>Tier<OptionSelect label="Filter endpoint tier" value={tier} onChange={setTier} options={[{ value: "all", label: "All tiers" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }]} /></label>
        </div>
        <div className="reference-list-count" aria-live="polite">{filtered.length} endpoints</div>
        <nav className="operation-nav" aria-label="API operations">
          {spec["x-user-journey"].map((group) => {
            const operations = filtered.filter((entry) => entry.operation["x-use-case"] === group.id);
            return operations.length > 0 && <section className="operation-group" key={group.id} aria-labelledby={`journey-${group.id}`}>
              <h3 id={`journey-${group.id}`}><span>{group.order}.</span> {group.title}</h3>
              {operations.map((e) => <button type="button" key={e.path} aria-current={active.path === e.path ? "true" : undefined} className={active.path === e.path ? "selected" : ""} onClick={() => { setSelected(e.path); location.hash = new URLSearchParams({ endpoint: e.path }).toString(); }}><span>{e.operation.summary}<i title={e.operation["x-coverage"] ?? "Service"} className={`coverage-dot ${e.operation["x-coverage"]}`} /></span><code><b>GET</b> {e.path}</code></button>)}
            </section>;
          })}
          {!filtered.length && <div className="empty-endpoints"><p>No matching endpoints.</p><button type="button" onClick={() => { setSearch(""); setTier("all"); setUseCase("all"); }}>Clear filters</button></div>}
        </nav>
      </aside>
      <main className="reference-content"><OperationPanel key={active.path} entry={active} spec={spec} server={server} apiKey={apiKey}
        workspace={workspaces[active.path] ?? initialWorkspace(active.operation)}
        updateWorkspace={(patch) => setWorkspaces((current) => ({ ...current, [active.path]: { ...(current[active.path] ?? initialWorkspace(active.operation)), ...patch } }))}
        controllers={controllers.current}
      /><section id="conventions" className="reference-conventions"><span className="eyebrow">Data conventions</span><h2>Read the values correctly.</h2><ul>{spec["x-data-conventions"].map((note) => <li key={note}>{note}</li>)}</ul><p className="subtle">Explore financial statements and ownership data. Historical market prices are not included.</p><div className="reference-links"><a href="/swagger.json" download="swagger_ledgerline.json">Download OpenAPI <Download size={14} aria-hidden="true" /></a>{spec.paths["/v1/coverage"] && <a href="#endpoint=%2Fv1%2Fcoverage">Dataset availability</a>}</div></section></main>
    </div><footer className="reference-footer">© {new Date().getFullYear()} Ledgerline. All rights reserved.<span>Contract v{spec.info.version}</span></footer>
  </div>;
}

function OperationPanel({ entry: { path, operation: op, aliases }, spec, server, apiKey, workspace, updateWorkspace, controllers }: { entry: Entry; spec: ApiSpec; server: string; apiKey: string; workspace: OperationWorkspace; updateWorkspace: (patch: Partial<OperationWorkspace>) => void; controllers: Map<string, AbortController> }) {
  const parameters = op.parameters ?? [];
  const { values, tab, status, output, busy, hasRequested, language } = workspace;
  const setValues = (values: Record<string, string>) => updateWorkspace({ values });
  const setTab = (tab: string) => updateWorkspace({ tab });
  const setStatus = (status: string) => updateWorkspace({ status });
  const setLanguage = (language: string) => updateWorkspace({ language });
  const query = new URLSearchParams(); let requestPath = path;
  for (const p of parameters) { const v = values[p.name]?.trim(); if (p.in === "path") requestPath = requestPath.replace(`{${p.name}}`, encodeURIComponent(v || `{${p.name}}`)); else if (v) query.set(p.name, v); }
  const requestUrl = `${server.trim().replace(/\/+$/, "")}${requestPath}${query.size ? `?${query}` : ""}`;
  const curl = `curl --request GET '${requestUrl.replace(/'/g, "'\\''")}' \\\n  --header 'Accept: application/json'${apiKey ? ' \\\n  --header "X-API-Key: $LEDGERLINE_API_KEY"' : ""}`;
  const snippet = language === "javascript"
    ? `const response = await fetch(${JSON.stringify(requestUrl)}, {\n  headers: {\n    Accept: "application/json",${apiKey ? '\n    "X-API-Key": process.env.LEDGERLINE_API_KEY,' : ""}\n  },\n});\n\nif (!response.ok) {\n  throw new Error(\`HTTP \${response.status}\`);\n}\nconst data = await response.json();\nconsole.log(data);`
    : language === "python"
      ? `import os\nimport requests\n\nresponse = requests.get(\n    ${JSON.stringify(requestUrl)},\n    headers={\n        "Accept": "application/json",${apiKey ? '\n        "X-API-Key": os.environ["LEDGERLINE_API_KEY"],' : ""}\n    },\n    timeout=${(op["x-timeout-ms"] ?? 15000) / 1000},\n)\nresponse.raise_for_status()\nprint(response.json())`
      : curl;
  const response = op.responses[status]!; const schema = response.content?.["application/json"]?.schema;
  const timeoutMs = op["x-timeout-ms"] ?? 15000;
  async function send() {
    if (controllers.has(path)) return;
    updateWorkspace({ tab: "request", hasRequested: true, busy: true, output: null });
    const started = performance.now();
    const controller = new AbortController();
    controllers.set(path, controller);
    try {
      if (parameters.some((p) => p.required && !values[p.name]?.trim())) throw new Error("Fill all required parameters before sending.");
      const target = new URL(requestUrl); if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("Use an HTTP or HTTPS server URL without embedded credentials.");
      const res = await fetch(target, { headers: { Accept: "application/json", ...(apiKey.trim() ? { "X-API-Key": apiKey.trim() } : {}) }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]), credentials: "omit" }); const text = await res.text();
      let formatted = text; try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Show non-JSON upstream failures. */ }
      updateWorkspace({ output: { status: `HTTP ${res.status} ${res.statusText}`, requestUrl, ok: res.ok, duration: Math.round(performance.now() - started), headers: Array.from(res.headers.entries()), text: formatted.length > 100_000 ? formatted.slice(0, 100_000) + "\n… Response truncated at 100,000 characters." : formatted || "(empty response)" } });
    } catch (e) { updateWorkspace({ output: { status: "Request failed", requestUrl, ok: false, text: e instanceof Error ? e.name === "AbortError" ? "Request cancelled." : e.name === "TimeoutError" ? `The request timed out after ${timeoutMs / 1000} seconds. Retry or check the API server logs.` : e instanceof TypeError ? "Could not reach the API. Check the base URL, confirm the server is running, and ensure it allows requests from this site's origin (CORS)." : e.message : "Could not reach the API server" } }); }
    finally { controllers.delete(path); updateWorkspace({ busy: false }); }
  }
  const codeExample = <div className="request-example" key="code-example"><div className="request-code-heading"><label className="code-label">Code example<OptionSelect label="Code language" value={language} onChange={setLanguage} options={[{ value: "curl", label: "cURL" }, { value: "javascript", label: "JavaScript (Node.js)" }, { value: "python", label: "Python" }]} /></label><CopyButton text={snippet} label="Copy code" /></div><pre>{snippet}</pre><p className="snippet-hint">{apiKey ? <>Set <code>LEDGERLINE_API_KEY</code> in your environment to run this example.</> : "Add your API key above to include authentication in this example."}</p></div>;
  const liveResponse = <div className="live-response" key="live-response" aria-live="polite" aria-busy={busy}><div className="response-toolbar"><h3>Live response</h3>{output && <><span className={output.ok ? "response-ok" : "response-error"}>{output.status}</span>{output.duration !== undefined && <small>{output.duration} ms</small>}<CopyButton text={output.text} label="Copy response" /></>}</div>{output ? <><p className="response-request-url"><code>{output.requestUrl}</code></p><pre>{output.text}</pre>{output.headers && <details className="response-headers"><summary>Response headers ({output.headers.length})</summary><dl>{output.headers.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></details>}</> : <div className="response-placeholder"><span>Waiting for the API…</span><p>The response will appear here.</p></div>}</div>;
  const requestInputs = <div className="request-inputs"><div className="parameter-heading"><h3>Parameters</h3><span>{parameters.length} inputs</span></div>
    {parameters.length ? <div className="parameter-list">{parameters.map((p) => <div className="parameter-row" key={`${p.in}-${p.name}`}>
      <label htmlFor={`param-${p.name}`}><code>{p.name}</code><small>{p.in} · {typeLabel(p.schema)}{p.required ? " · required" : " · optional"}</small></label>
      <div>{p.schema.enum ? <OptionSelect label={p.name} id={`param-${p.name}`} value={values[p.name] ?? ""} onChange={(value) => setValues({ ...values, [p.name]: value })} options={[...(!p.required ? [{ value: "", label: "Omit" }] : []), ...p.schema.enum.map((value) => ({ value, label: value }))]} /> : p.name === "query" ? <textarea className="input query-textarea" id={`param-${p.name}`} required={p.required} rows={3} value={values[p.name] ?? ""} placeholder={Array.isArray(p.example) ? p.example.join(",") : String(p.example ?? "")} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} /> : <input className="input" id={`param-${p.name}`} required={p.required} type={p.schema.format === "date" ? "date" : "text"} value={values[p.name] ?? ""} placeholder={Array.isArray(p.example) ? p.example.join(",") : String(p.example ?? "")} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} />}<p>{p.description}</p>{p.schema.maxItems && <small>Maximum {p.schema.maxItems} symbols</small>}</div>
    </div>)}</div> : <p className="subtle">No parameters required. You can send this request directly.</p>}
    <p className="request-timeout">GET request · {timeoutMs / 1000}s timeout</p>
  </div>;
  const ratioGallery = path === "/api/v1/screen" && <ScreeningRatioGallery onInsert={(value) => {
    const current = values.query ?? "";
    const isOperator = ["+", "-", "/", "*", ">", "<", "AND", "OR"].includes(value);
    const insertion = isOperator && !["+", "-", "/", "*", ">", "<"].includes(value) ? ` ${value} ` : value;
    setValues({ ...values, query: `${current}${current && !/\s$/.test(current) ? " " : ""}${insertion}` });
    document.getElementById("param-query")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }} />;
  return <article className="operation-panel"><div className="operation-heading"><div className="operation-summary-row"><div className="endpoint-top"><span className="method">GET</span><span className="eyebrow">{op["x-tier"] === "paid" ? "Paid tier" : "Free tier"}</span><span className={`coverage-badge ${op["x-coverage"]}`}>{op["x-coverage"] === "unavailable" ? "Source required · 501" : op["x-coverage"] === "partial" ? "Partial data" : op["x-coverage"]}</span></div><div className="endpoint-send-actions">{busy && <button className="cancel-request" type="button" onClick={() => controllers.get(path)?.abort()}>Cancel</button>}<button className="button" type="button" disabled={busy} onClick={send}><Send size={14} aria-hidden="true" />{busy ? "Sending…" : "Send request"}</button></div></div><h2>{op.summary}</h2><code className="operation-path">{path}</code>{aliases.length > 0 && <p className="subtle">Also available at {aliases.map((alias) => <code key={alias}>{alias}</code>)}</p>}<p>{op.description}</p><p className="subtle">API format: {op["x-api-style"]}</p></div>
    <div className="reference-tabs" role="tablist" aria-label="Operation detail">{["request", "response", "schema"].map((name, index, tabs) => <button type="button" role="tab" id={`tab-${name}`} aria-controls="operation-tab-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} key={name} onClick={() => setTab(name)} onKeyDown={(event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); setTab(tabs[next]!); document.getElementById(`tab-${tabs[next]}`)?.focus();
    }}>{name === "response" ? "Response examples" : name === "schema" ? "Response schema" : "Try it out"}</button>)}</div>
    {tab === "request" && <section role="tabpanel" id="operation-tab-panel" aria-labelledby={`tab-${tab}`} className="operation-body request-workspace" data-requested={hasRequested}>
      {hasRequested ? <><div className="request-left-column">{requestInputs}{codeExample}{ratioGallery}</div>{liveResponse}</> : <>{requestInputs}{codeExample}{ratioGallery}</>}
    </section>}
    {tab !== "request" && <section role="tabpanel" id="operation-tab-panel" aria-labelledby={`tab-${tab}`} className="operation-body"><label className="response-status">Response<OptionSelect label="Response status" value={status} onChange={setStatus} options={Object.keys(op.responses).map((value) => ({ value, label: value }))} /></label><p className="subtle">{response.description}</p>{schema && (tab === "schema" ? <SchemaTree schema={schema} spec={spec} /> : <><span className="code-label">Synthetic shape example · not live data</span><div className="synthetic-code"><CopyButton text={JSON.stringify(example(schema, spec), null, 2)} label="Copy example" /><pre>{JSON.stringify(example(schema, spec), null, 2)}</pre></div></>)}{response.headers && <details className="response-headers"><summary>Response headers</summary>{Object.entries(response.headers).map(([name, h]) => <p key={name}><code>{name}</code> — {h.description}</p>)}</details>}</section>}
  </article>;
}
