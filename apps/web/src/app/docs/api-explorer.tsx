"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import "./reference.css";
import { ThemePicker } from "../../components/theme-picker";

type Schema = { $ref?: string; type?: string; nullable?: boolean; description?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; additionalProperties?: boolean | Schema; enum?: string[]; format?: string; oneOf?: Schema[]; anyOf?: Schema[]; example?: unknown; minimum?: number; maxItems?: number };
type Parameter = { name: string; in: string; required?: boolean; description?: string; schema: Schema; example?: unknown };
type ApiResponse = { description: string; content?: Record<string, { schema: Schema }>; headers?: Record<string, { description?: string; schema: Schema }> };
type Operation = { operationId: string; summary: string; description?: string; tags?: string[]; parameters?: Parameter[]; responses: Record<string, ApiResponse>; "x-coverage"?: string; "x-alias"?: boolean; "x-resource"?: string; "x-canonical-path"?: string; "x-timeout-ms"?: number };
export type ApiSpec = { openapi: string; info: { title: string; version: string; description: string }; servers: { url: string }[]; paths: Record<string, { get?: Operation }>; components: { schemas: Record<string, Schema> }; "x-coverage-summary": { total: number; partial: number; unavailable: number; excluded: number; inspectedAt: string }; "x-data-conventions": string[] };
type Entry = { path: string; operation: Operation; aliases: string[] };

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
  const entries = useMemo(() => Object.entries(spec.paths).flatMap(([path, item]) => item.get && !item.get["x-alias"] ? [{ path, operation: item.get, aliases: Object.entries(spec.paths).filter(([, alias]) => alias.get?.["x-alias"] && alias.get["x-canonical-path"] === path).map(([alias]) => alias) }] : []), [spec]);
  const [search, setSearch] = useState(""); const [tier, setTier] = useState("all"); const [coverage, setCoverage] = useState("all");
  const [selected, setSelected] = useState("/api/v1/financials/{symbol}"); const [server, setServer] = useState(initialServer);
  const [apiKey, setApiKey] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sync = () => { const endpoint = new URLSearchParams(location.hash.slice(1)).get("endpoint"); if (endpoint && entries.some((entry) => entry.path === endpoint)) setSelected(endpoint); };
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); searchInput.current?.focus(); } };
    sync(); window.addEventListener("hashchange", sync); window.addEventListener("keydown", shortcut);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("keydown", shortcut); };
  }, [entries]);
  const filtered = entries.filter(({ path, operation: op, aliases }) => (tier === "all" || op.tags?.includes(tier)) && (coverage === "all" || op["x-coverage"] === coverage) && `${path} ${aliases.join(" ")} ${op.summary} ${op.description ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.find((e) => e.path === selected) ?? filtered[0] ?? entries.find((e) => e.path === selected) ?? entries[0]!; const counts = spec["x-coverage-summary"];
  return <div className="docs reference-page">
    <header className="reference-topbar"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline<span className="reference-divider">/</span><span className="reference-caption">API reference</span></Link><div className="docs-actions"><ThemePicker /><a className="button secondary" href="/swagger.json" download="swagger_ledgerline.json">OpenAPI ↓</a><Link className="button" href="/dashboard">Dashboard ↗</Link></div></header>
    <section className="reference-hero"><div><span className="eyebrow">DEVELOPER DOCUMENTATION · v{spec.info.version}</span><h1>API reference</h1><p className="subtle">Find an endpoint. Configure your request. Build with Indian market data.</p></div><a className="reference-contract" href="/swagger.json">OpenAPI {spec.openapi} ↗</a></section>
    <section className="connection-bar" aria-label="API connection"><label>Base URL<input className="input mono" aria-label="API server" value={server} onChange={(e) => setServer(e.target.value)} spellCheck={false} /></label><label>API key<input className="input mono" type="password" autoComplete="off" aria-label="API key" placeholder="Paste your API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /><small>Sent as X-API-Key. Kept in memory for this page only.</small></label><Link href="/dashboard">Manage keys ↗</Link></section>
    <div className="reference-notice"><span className="pill">Coverage</span><p>Partial responses may contain <code>null</code> values. Endpoints marked “Source gap” return <code>501</code>.</p><a href="#conventions">Data conventions ↓</a></div>
    <div className="reference-layout">
      <aside className="reference-nav"><label className="search-label" htmlFor="endpoint-search">Endpoints <kbd>⌘ / Ctrl K</kbd></label><input ref={searchInput} id="endpoint-search" className="input" type="search" placeholder="Search endpoints…" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="reference-filters"><label>Tier<select aria-label="Filter endpoint tier" value={tier} onChange={(e) => setTier(e.target.value)}><option value="all">All tiers</option>{["personal", "enterprise", "legacy", "service"].map((t) => <option key={t}>{t}</option>)}</select></label><label>Coverage<select aria-label="Filter endpoint coverage" value={coverage} onChange={(e) => setCoverage(e.target.value)}><option value="all">All coverage</option><option value="partial">Partial data</option><option value="unavailable">Source gap</option></select></label></div><div className="reference-list-count">{filtered.length} endpoints</div><nav className="operation-nav" aria-label="API operations">{filtered.map((e) => <button type="button" key={e.path} aria-current={active.path === e.path ? "true" : undefined} className={active.path === e.path ? "selected" : ""} onClick={() => { setSelected(e.path); location.hash = new URLSearchParams({ endpoint: e.path }).toString(); }}><span>{e.operation.summary}<i title={e.operation["x-coverage"] ?? "Service"} className={`coverage-dot ${e.operation["x-coverage"]}`} /></span><code><b>GET</b> {e.path}</code></button>)}{!filtered.length && <div className="empty-endpoints"><p>No matching endpoints.</p><button type="button" onClick={() => { setSearch(""); setTier("all"); setCoverage("all"); }}>Clear filters</button></div>}</nav></aside>
      <main className="reference-content"><OperationPanel key={active.path} entry={active} spec={spec} server={server} setServer={setServer} apiKey={apiKey} setApiKey={setApiKey} /><section id="conventions" className="reference-conventions"><span className="eyebrow">Data conventions</span><h2>Read the values correctly.</h2><ul>{spec["x-data-conventions"].map((note) => <li key={note}>{note}</li>)}</ul><p className="subtle">Explore financial statements and ownership histories. Historical market prices are not included.</p><div className="reference-links"><a href="/swagger.json" download="swagger_ledgerline.json">Download OpenAPI ↗</a><a href={`${server.replace(/\/$/, "")}/v1/coverage`} target="_blank" rel="noreferrer">Dataset availability ↗</a></div></section></main>
    </div><footer className="reference-footer">Ledgerline / Independent Indian financial data<span>Contract v{spec.info.version}</span></footer>
  </div>;
}

function OperationPanel({ entry: { path, operation: op, aliases }, spec, server, setServer, apiKey, setApiKey }: { entry: Entry; spec: ApiSpec; server: string; setServer: (value: string) => void; apiKey: string; setApiKey: (value: string) => void }) {
  const parameters = op.parameters ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(parameters.map((p) => [p.name, p.required || p.name === "symbol" ? (Array.isArray(p.example) ? p.example.join(",") : String(p.example ?? p.schema.enum?.[0] ?? "")) : ""])));
  const [tab, setTab] = useState("request"); const [status, setStatus] = useState(Object.keys(op.responses)[0]!);
  const [output, setOutput] = useState<{ status: string; text: string; ok?: boolean; duration?: number; headers?: [string, string][] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState("curl");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
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
    setBusy(true); setOutput(null);
    const started = performance.now();
    controller.current = new AbortController();
    try {
      if (parameters.some((p) => p.required && !values[p.name]?.trim())) throw new Error("Fill all required parameters before sending.");
      const target = new URL(requestUrl); if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("Use an HTTP or HTTPS server URL without embedded credentials.");
      const res = await fetch(target, { headers: { Accept: "application/json", ...(apiKey.trim() ? { "X-API-Key": apiKey.trim() } : {}) }, signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(timeoutMs)]), credentials: "omit" }); const text = await res.text();
      let formatted = text; try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Show non-JSON upstream failures. */ }
      setOutput({ status: `HTTP ${res.status} ${res.statusText}`, ok: res.ok, duration: Math.round(performance.now() - started), headers: Array.from(res.headers.entries()), text: formatted.length > 100_000 ? formatted.slice(0, 100_000) + "\n… Response truncated at 100,000 characters." : formatted || "(empty response)" });
    } catch (e) { setOutput({ status: "Request failed", ok: false, text: e instanceof Error ? e.name === "AbortError" ? "Request cancelled." : e.name === "TimeoutError" ? `The request timed out after ${timeoutMs / 1000} seconds. Retry or check the API server logs.` : e instanceof TypeError ? "Could not reach the API. Check the base URL, confirm the server is running, and ensure it allows requests from this site's origin (CORS)." : e.message : "Could not reach the API server" }); }
    finally { setBusy(false); }
  }
  return <article className="operation-panel"><div className="operation-heading"><div className="endpoint-top"><span className="method">GET</span><span className="eyebrow">{op.tags?.[0]}</span><span className={`coverage-badge ${op["x-coverage"]}`}>{op["x-coverage"] === "unavailable" ? "Source required · 501" : op["x-coverage"] === "partial" ? "Partial data" : op["x-coverage"]}</span></div><h2>{op.summary}</h2><code className="operation-path">{path}</code>{aliases.length > 0 && <p className="subtle">Also available at {aliases.map((alias) => <code key={alias}>{alias}</code>)}</p>}<p>{op.description}</p></div>
    <div className="reference-tabs" role="tablist" aria-label="Operation detail">{["request", "response", "schema"].map((name, index, tabs) => <button type="button" role="tab" id={`tab-${name}`} aria-controls="operation-tab-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} key={name} onClick={() => setTab(name)} onKeyDown={(event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); setTab(tabs[next]!); document.getElementById(`tab-${tabs[next]}`)?.focus();
    }}>{name === "response" ? "Response examples" : name === "schema" ? "Response schema" : "Try it out"}</button>)}</div>
    {tab === "request" && <section role="tabpanel" id="operation-tab-panel" aria-labelledby={`tab-${tab}`} className="operation-body request-workspace">
      <div className="request-inputs"><div className="parameter-heading"><h3>Parameters</h3><span>{parameters.length} inputs</span></div>
        {parameters.length ? <div className="parameter-list">{parameters.map((p) => <div className="parameter-row" key={`${p.in}-${p.name}`}>
          <label htmlFor={`param-${p.name}`}><code>{p.name}</code><small>{p.in} · {typeLabel(p.schema)}{p.required ? " · required" : " · optional"}</small></label>
          <div>{p.schema.enum ? <select className="input" id={`param-${p.name}`} value={values[p.name] ?? ""} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>{!p.required && <option value="">Omit</option>}{p.schema.enum.map((v) => <option key={v}>{v}</option>)}</select> : <input className="input" id={`param-${p.name}`} required={p.required} type={p.schema.format === "date" ? "date" : "text"} value={values[p.name] ?? ""} placeholder={Array.isArray(p.example) ? p.example.join(",") : String(p.example ?? "")} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} />}<p>{p.description}</p>{p.schema.maxItems && <small>Maximum {p.schema.maxItems} symbols</small>}</div>
        </div>)}</div> : <p className="subtle">No parameters required. You can send this request directly.</p>}
        <div className="send-row"><button className="button" type="button" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send request →"}</button>{busy && <button className="cancel-request" type="button" onClick={() => controller.current?.abort()}>Cancel</button>}<p>GET request · {timeoutMs / 1000}s timeout</p></div>
      </div>
      <div className="request-example"><div className="request-code-heading"><label className="code-label">Code example<select aria-label="Code language" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="curl">cURL</option><option value="javascript">JavaScript (Node.js)</option><option value="python">Python</option></select></label><CopyButton text={snippet} label="Copy code" /></div><pre>{snippet}</pre><p className="snippet-hint">{apiKey ? <>Set <code>LEDGERLINE_API_KEY</code> in your environment to run this example.</> : "Add your API key above to include authentication in this example."}</p></div>
      <div className="live-response" aria-live="polite" aria-busy={busy}><div className="response-toolbar"><h3>Live response</h3>{output && <><span className={output.ok ? "response-ok" : "response-error"}>{output.status}</span>{output.duration !== undefined && <small>{output.duration} ms</small>}<CopyButton text={output.text} label="Copy response" /></>}</div>{output ? <><pre>{output.text}</pre>{output.headers && <details className="response-headers"><summary>Response headers ({output.headers.length})</summary><dl>{output.headers.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></details>}</> : <div className="response-placeholder"><span>{busy ? "Waiting for the API…" : "Ready when you are"}</span><p>{busy ? "The response will appear here." : "Send a request to inspect the status, timing, headers and response body."}</p></div>}</div>
    </section>}
    {tab !== "request" && <section role="tabpanel" id="operation-tab-panel" aria-labelledby={`tab-${tab}`} className="operation-body"><label className="response-status">Response<select className="input" aria-label="Response status" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.keys(op.responses).map((code) => <option key={code}>{code}</option>)}</select></label><p className="subtle">{response.description}</p>{schema && (tab === "schema" ? <SchemaTree schema={schema} spec={spec} /> : <><span className="code-label">Synthetic shape example · not live data</span><pre>{JSON.stringify(example(schema, spec), null, 2)}</pre></>)}{response.headers && <details className="response-headers"><summary>Response headers</summary>{Object.entries(response.headers).map(([name, h]) => <p key={name}><code>{name}</code> — {h.description}</p>)}</details>}</section>}
  </article>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [feedback, setFeedback] = useState("");
  useEffect(() => { setFeedback(""); }, [text]);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(""), 2000); return () => clearTimeout(timer); }, [feedback]);
  return <button className="copy-button" type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setFeedback("Copied ✓"); } catch { setFeedback("Select text to copy"); } }} aria-live="polite">{feedback || label}</button>;
}
