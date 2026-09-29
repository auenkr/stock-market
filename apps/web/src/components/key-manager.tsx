"use client";

import { useEffect, useState } from "react";

type Key = { id: string; name: string; prefix: string; createdAt: string; revokedAt: string | null; requestLimit: number };
type KeysResponse = { keys: Key[] };
type ErrorResponse = { error: string };

export function KeyManager() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/keys");
    if (response.ok) setKeys((await response.json() as KeysResponse).keys);
  }
  useEffect(() => { void load(); }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setError(null); setNewKey(null);
    const response = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await response.json() as Partial<ErrorResponse> & { key?: string; prefix?: string; name?: string };
    if (!response.ok) { setError(body.error ?? "Could not create key"); return; }
    if (!body.key) { setError("The server did not return a key"); return; }
    setNewKey(body.key); setName(""); await load();
  }
  async function revoke(id: string) {
    await fetch("/api/keys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    await load();
  }

  return <>
    <div className="card-grid">
      <section className="card"><div className="section-head"><div><h2>Issue a key</h2><div className="subtle">Use one key per application or environment.</div></div></div>
        <form className="form" onSubmit={create}><input className="input" required maxLength={80} placeholder="e.g. Research dashboard" value={name} onChange={(event) => setName(event.target.value)} /><button className="button secondary" type="submit">Create secret key</button></form>
        {error && <p className="error">{error}</p>}
      </section>
      <section className="card"><h2>Usage policy</h2><p className="subtle">Keys are limited to 60 requests per minute by default. Detailed company data is cached for 15 minutes.</p><span className="pill">60 RPM</span></section>
    </div>
    {newKey && <div className="notice"><strong>Copy this key now.</strong> It will not be shown again.<br /><code className="mono">{newKey}</code></div>}
    <section className="card" style={{ marginTop: 18 }}><div className="section-head"><div><h2>Your keys</h2><div className="subtle">Secrets are hashed before they are stored.</div></div><span className="pill">{keys.filter((key) => !key.revokedAt).length} active</span></div>
      {keys.length === 0 ? <div className="empty">No API keys yet. Create one above to connect your first client.</div> : keys.map((key) => <div className="key-row" key={key.id}><div><div className="key-name">{key.name}</div><div className="key-meta mono">{key.prefix}•••••••• · {key.requestLimit} RPM</div></div>{key.revokedAt ? <span className="pill">revoked</span> : <button className="button danger" onClick={() => void revoke(key.id)}>Revoke</button>}</div>)}
    </section>
  </>;
}
