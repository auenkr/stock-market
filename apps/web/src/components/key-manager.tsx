"use client";

import { useEffect, useState } from "react";

type Key = { id: string; name: string; prefix: string; secret: string | null; createdAt: string; revokedAt: string | null; requestLimit: number };
type Policy = { title: string; description: string; requestLimit: number };
type KeysResponse = { keys: Key[]; policy: Policy };
type ErrorResponse = { error: string };

export function KeyManager() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<Policy | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/keys");
      const body = await response.json() as Partial<KeysResponse> & Partial<ErrorResponse>;
      if (!response.ok) throw new Error(body.error ?? "Could not load saved API keys.");
      setKeys(body.keys ?? []);
      setPolicy(body.policy ?? null);
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Could not load saved API keys.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setError(null); setNewKey(null);
    const response = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await response.json() as Partial<ErrorResponse> & { key?: string; prefix?: string; name?: string };
    if (!response.ok) { setError(body.error ?? "Could not create key"); return; }
    if (!body.key) { setError("The server did not return a key"); return; }
    setNewKey(body.key); setKeyVisible(false); setName(""); await load();
  }
  async function revoke(id: string) {
    await fetch("/api/keys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    await load();
  }
  async function copy(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => current === id ? null : current), 1800);
    } catch {
      setError("Could not copy the key. Select and copy it manually.");
    }
  }

  return <>
    <div className="card-grid">
      <section className="card"><div className="section-head"><div><h2>Issue a key</h2><div className="subtle">Use one key per application or environment.</div></div></div>
        <form className="form" onSubmit={create}><input className="input" required maxLength={80} placeholder="e.g. Research dashboard" value={name} onChange={(event) => setName(event.target.value)} /><button className="button secondary" type="submit">Create secret key</button></form>
        {error && <p className="error">{error}</p>}
      </section>
      <section className="card"><h2>{policy?.title ?? "Usage policy"}</h2>{policy ? <><p className="subtle">{policy.description}</p><span className="pill">{policy.requestLimit} requests / minute per new key</span></> : loading ? <div className="key-skeleton" aria-label="Loading usage policy"><span /><span /></div> : <p className="subtle">Usage policy could not be loaded.</p>}</section>
    </div>
    {newKey && <div className="notice" style={{ marginTop: 18 }}><strong>Your new API key.</strong> It remains available here until you revoke it.
      <div className="created-key">
        <input id="created-api-key" className="input mono" aria-label="New API key" type={keyVisible ? "text" : "password"} value={newKey} readOnly autoComplete="off" spellCheck={false} />
        <button className="button secondary" type="button" onClick={() => void copy(newKey, "new")}>{copied === "new" ? "Copied ✓" : "Copy key"}</button>
        <button className="button" type="button" aria-controls="created-api-key" aria-pressed={keyVisible} onClick={() => setKeyVisible(!keyVisible)}>{keyVisible ? "Hide key" : "Show key"}</button>
      </div>
    </div>}
    <section className="card" style={{ marginTop: 18 }}><div className="section-head"><div><h2>Your keys</h2><div className="subtle">Reveal a key to view and copy it.</div></div>{!loading && <span className="pill">{keys.filter((key) => !key.revokedAt).length} active</span>}</div>
      {loadError ? <div className="error" role="alert">{loadError}</div> : loading ? <div role="status" aria-label="Loading your keys" aria-busy="true"><span className="sr-only">Loading your keys</span>{[0, 1, 2].map((id) => <div className="key-row key-skeleton" aria-hidden="true" key={id}><div><span /><span /></div><div className="skeleton-actions"><span /><span /></div></div>)}</div> : keys.length === 0 ? <div className="empty">No API keys yet. Create one above to connect your first client.</div> : keys.map((key) => {
        const visible = visibleKeys.includes(key.id);
        return <div className="key-row" key={key.id}><div className="key-details"><div className="key-name">{key.name} <span className="key-meta">· {key.requestLimit} RPM</span></div><input id={`key-${key.id}`} className="key-secret mono" aria-label={`${key.name} API key`} value={visible && key.secret ? key.secret : `${key.prefix}••••••••••••••••`} readOnly autoComplete="off" spellCheck={false} /></div><div className="key-actions">{key.revokedAt ? <span className="pill">revoked</span> : <><button className="button secondary key-copy" style={{ visibility: visible && key.secret ? "visible" : "hidden" }} tabIndex={visible && key.secret ? 0 : -1} type="button" onClick={() => key.secret && void copy(key.secret, key.id)}>{copied === key.id ? "Copied ✓" : "Copy key"}</button><button className="button secondary key-reveal" type="button" disabled={!key.secret} title={!key.secret ? "Create a replacement to reveal this key" : undefined} aria-controls={`key-${key.id}`} aria-pressed={visible} onClick={() => setVisibleKeys((current) => visible ? current.filter((id) => id !== key.id) : [...current, key.id])}>{visible ? "Hide key" : "Show key"}</button><button className="button danger" onClick={() => void revoke(key.id)}>Revoke</button></>}</div></div>;
      })}
    </section>
  </>;
}
