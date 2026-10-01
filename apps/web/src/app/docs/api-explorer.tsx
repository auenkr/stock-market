"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
  const filtered = entries.filter(({ path, operation: op, aliases }) => (tier === "all" || op.tags?.includes(tier)) && (coverage === "all" || op["x-coverage"] === coverage) && `${path} ${aliases.join(" ")} ${op.summary} ${op.description ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.find((e) => e.path === selected) ?? filtered[0] ?? entries.find((e) => e.path === selected) ?? entries[0]!; const counts = spec["x-coverage-summary"];
  return <div className="docs reference-page">
    <header className="reference-topbar"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline<span className="reference-divider">/</span><span className="reference-caption">API reference</span></Link><div className="docs-actions"><a className="button secondary" href="/swagger.json" download>Download Swagger ↓</a><Link className="button" href="/dashboard">Dashboard ↗</Link></div></header>
    <section className="reference-hero"><div><span className="eyebrow">OpenAPI {spec.openapi} · API {spec.info.version}</span><h1>Your data. One clear contract.</h1><p className="subtle">Explore company fundamentals, ownership and corporate events. Every parameter, response schema and coverage note below comes from Swagger.</p></div><div className="reference-stats"><div><strong>{counts.partial}</strong><span>partial adapters</span></div><div><strong>{counts.unavailable}</strong><span>source gaps · 501</span></div><div><strong>{counts.excluded}</strong><span>history exclusions</span></div></div></section>
    <div className="reference-notice"><span className="pill">Development</span><p>Source-backed responses have partial coverage. Missing values are <code>null</code>. API key validation, paid plans and shared quotas are pending.</p><a href="#conventions">Data conventions ↓</a></div>
    <div className="reference-layout">
      <aside className="reference-nav"><label className="search-label" htmlFor="endpoint-search">Find an endpoint</label><input id="endpoint-search" className="input" type="search" placeholder="Search paths or datasets…" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="reference-filters"><label>Tier<select aria-label="Filter endpoint tier" value={tier} onChange={(e) => setTier(e.target.value)}><option value="all">All tiers</option>{["personal", "enterprise", "legacy", "service"].map((t) => <option key={t}>{t}</option>)}</select></label><label>Coverage<select aria-label="Filter endpoint coverage" value={coverage} onChange={(e) => setCoverage(e.target.value)}><option value="all">All coverage</option><option value="partial">Partial data</option><option value="unavailable">Source gap</option></select></label></div><div className="reference-list-count">{filtered.length} operations · aliases hidden</div><nav className="operation-nav" aria-label="API operations">{filtered.map((e) => <button type="button" key={e.path} aria-current={active.path === e.path ? "true" : undefined} className={active.path === e.path ? "selected" : ""} onClick={() => setSelected(e.path)}><span>{e.operation.summary}<i className={`coverage-dot ${e.operation["x-coverage"]}`} /></span><code>{e.path}</code><small>{e.operation.tags?.[0]}</small></button>)}{!filtered.length && <p className="subtle">No matching endpoints. Try another search or filter.</p>}</nav></aside>
      <main className="reference-content"><OperationPanel key={active.path} entry={active} spec={spec} server={server} setServer={setServer} /><section id="conventions" className="reference-conventions"><span className="eyebrow">Data conventions</span><h2>Read the values correctly.</h2><ul>{spec["x-data-conventions"].map((note) => <li key={note}>{note}</li>)}</ul><p className="subtle">Coverage inspected {counts.inspectedAt}. {counts.total} reference paths include personal and enterprise resources; aliases and legacy/service routes are counted separately. Financial statement and ownership histories remain in scope. Market-price histories are excluded.</p><div className="reference-links"><a href="/swagger.json">Swagger contract ↗</a><a href={`${server.replace(/\/$/, "")}/v1/coverage`} target="_blank" rel="noreferrer">Runtime coverage ↗</a></div></section></main>
    </div><footer className="reference-footer">Ledgerline / Independent Indian financial data<span>Contract v{spec.info.version}</span></footer>
  </div>;
}

function OperationPanel({ entry: { path, operation: op, aliases }, spec, server, setServer }: { entry: Entry; spec: ApiSpec; server: string; setServer: (value: string) => void }) {
  const parameters = op.parameters ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(parameters.map((p) => [p.name, p.required || p.name === "symbol" ? (Array.isArray(p.example) ? p.example.join(",") : String(p.example ?? p.schema.enum?.[0] ?? "")) : ""])));
  const [tab, setTab] = useState("request"); const [status, setStatus] = useState(Object.keys(op.responses)[0]!);
  const [key, setKey] = useState(""); const [output, setOutput] = useState<{ status: string; text: string } | null>(null); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false);
  const query = new URLSearchParams(); let requestPath = path;
  for (const p of parameters) { const v = values[p.name]?.trim(); if (p.in === "path") requestPath = requestPath.replace(`{${p.name}}`, encodeURIComponent(v || `{${p.name}}`)); else if (v) query.set(p.name, v); }
  const requestUrl = `${server.replace(/\/$/, "")}${requestPath}${query.size ? `?${query}` : ""}`;
  const curl = `curl '${requestUrl.replace(/'/g, "'\\''")}'${key ? " \\\n  -H 'X-API-Key: <your-key>'" : ""}`;
  const response = op.responses[status]!; const schema = response.content?.["application/json"]?.schema;
  const timeoutMs = op["x-timeout-ms"] ?? 15000;
  async function send() {
    setBusy(true); setOutput(null);
    try {
      if (parameters.some((p) => p.required && !values[p.name]?.trim())) throw new Error("Fill all required parameters before sending.");
      const target = new URL(requestUrl); if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("Use an HTTP or HTTPS server URL without embedded credentials.");
      const res = await fetch(target, { headers: key ? { "X-API-Key": key } : {}, signal: AbortSignal.timeout(timeoutMs), credentials: "omit" }); const text = await res.text();
      let formatted = text; try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Show non-JSON upstream failures. */ }
      setOutput({ status: `HTTP ${res.status}${res.headers.get("x-data-coverage") ? " · " + res.headers.get("x-data-coverage") : ""}`, text: formatted.slice(0, 100_000) });
    } catch (e) { setOutput({ status: "Request failed", text: e instanceof Error ? e.name === "TimeoutError" ? `The request timed out after ${timeoutMs / 1000} seconds. Retry or check the API server logs.` : e.message : "Could not reach the API server" }); }
    finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(curl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setOutput({ status: "Copy unavailable", text: "Select and copy the request example manually." }); } }
  return <article className="operation-panel"><div className="operation-heading"><div className="endpoint-top"><span className="method">GET</span><span className="eyebrow">{op.tags?.[0]}</span><span className={`coverage-badge ${op["x-coverage"]}`}>{op["x-coverage"] === "unavailable" ? "Source required · 501" : op["x-coverage"] === "partial" ? "Partial data" : op["x-coverage"]}</span></div><h2>{op.summary}</h2><code className="operation-path">{path}</code>{aliases.length > 0 && <p className="subtle">Also available at {aliases.map((alias) => <code key={alias}>{alias}</code>)}</p>}<p>{op.description}</p></div>
    <div className="reference-tabs" role="tablist" aria-label="Operation detail">{["request", "response", "schema"].map((name) => <button type="button" role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)}>{name}</button>)}</div>
    {tab === "request" && <section role="tabpanel" className="operation-body"><div className="request-settings"><label>API server<input className="input mono" aria-label="API server" value={server} onChange={(e) => setServer(e.target.value)} /></label><label>Optional quota key<input className="input" type="password" autoComplete="off" aria-label="Optional quota key" placeholder="X-API-Key · development identifier" value={key} onChange={(e) => setKey(e.target.value)} /></label></div><div className="parameter-heading"><h3>Parameters</h3><span>{parameters.length} inputs</span></div>{parameters.length ? <div className="parameter-list">{parameters.map((p) => <div className="parameter-row" key={`${p.in}-${p.name}`}><label htmlFor={`param-${p.name}`}><code>{p.name}</code><small>{p.in} · {typeLabel(p.schema)}{p.required ? " · required" : " · optional"}</small></label><div>{p.schema.enum ? <select className="input" id={`param-${p.name}`} value={values[p.name] ?? ""} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>{!p.required && <option value="">Omit</option>}{p.schema.enum.map((v) => <option key={v}>{v}</option>)}</select> : <input className="input" id={`param-${p.name}`} type={p.schema.format === "date" ? "date" : "text"} value={values[p.name] ?? ""} placeholder={Array.isArray(p.example) ? p.example.join(",") : String(p.example ?? "")} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} />}<p>{p.description}</p>{p.schema.maxItems && <small>Maximum {p.schema.maxItems} symbols</small>}</div></div>)}</div> : <p className="subtle">This operation has no parameters.</p>}<div className="request-code-heading"><span className="code-label">Request · cURL</span><button type="button" onClick={copy}>{copied ? "Copied ✓" : "Copy request"}</button></div><pre>{curl}</pre><div className="send-row"><button className="button secondary" type="button" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send request ↗"}</button><p>Uses the server above. Start your API locally or enter its deployed URL.</p></div>{output && <div className="live-response" aria-live="polite"><strong>{output.status}</strong><pre>{output.text}</pre></div>}</section>}
    {tab !== "request" && <section role="tabpanel" className="operation-body"><label className="response-status">Response<select className="input" aria-label="Response status" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.keys(op.responses).map((code) => <option key={code}>{code}</option>)}</select></label><p className="subtle">{response.description}</p>{schema && (tab === "schema" ? <SchemaTree schema={schema} spec={spec} /> : <><span className="code-label">Synthetic shape example · not live data</span><pre>{JSON.stringify(example(schema, spec), null, 2)}</pre></>)}{response.headers && <details className="response-headers"><summary>Response headers</summary>{Object.entries(response.headers).map(([name, h]) => <p key={name}><code>{name}</code> — {h.description}</p>)}</details>}</section>}
  </article>;
}
