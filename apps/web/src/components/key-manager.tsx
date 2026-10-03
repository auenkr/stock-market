"use client";

import { useEffect, useState } from "react";
import { CreateKeyDialog, type CreatedKey } from "@/components/create-key-dialog";
import { KeySecret } from "@/components/key-secret";
import { KeyAction } from "@/components/key-action";
import { TooltipProvider } from "@stock-market/ui/components/tooltip";
import { isKeyExpired } from "@/lib/key-expiration";
import { Button } from "@stock-market/ui/components/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@stock-market/ui/components/dialog";

type Key = { id: string; name: string; secret: string | null; createdAt: string; expiresAt: string | null; revokedAt: string | null };
type Policy = { plan: "free" | "basic" | "personal" | "professional"; title: string; description: string; requestLimit: number };
type KeysResponse = { keys: Key[]; policy: Policy };
type ErrorResponse = { error: string };

export function KeyManager() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [newKey, setNewKey] = useState<CreatedKey | null>(null);
  const [now, setNow] = useState(Date.now());
  const [keyVisible, setKeyVisible] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Key | null>(null);
  const [revoking, setRevoking] = useState(false);

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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function created(key: CreatedKey) {
    setNewKey(key); setKeyVisible(false); setError(null); setNow(Date.now()); void load();
  }
  async function revoke() {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    try {
      const response = await fetch("/api/keys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: revokeTarget.id }) });
      if (!response.ok) throw new Error("Could not revoke the key. Please try again.");
      setNewKey(null); setError(null); setRevokeTarget(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke the key."); }
    finally { setRevoking(false); }
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

  return <TooltipProvider>
    <section className="card key-issue-card" data-reveal><div className="section-head"><div><h2>Issue a key</h2><div className="subtle">Use one key per application or environment.</div></div></div>
        <CreateKeyDialog onCreated={created} />
        {error && <p className="error">{error}</p>}
    </section>
    {policy && <section className="usage-summary"><span className="eyebrow">{policy.plan === "free" ? "Hobby" : policy.plan === "basic" ? "Basic" : policy.plan === "personal" ? "Personal" : "Professional"} plan</span><span className="pill">{policy.requestLimit} requests / minute per account</span><span className="subtle">Shared across all your API keys.</span></section>}
    {newKey && <div className="notice new-key-notice" data-visible={keyVisible} style={{ marginTop: 18 }}><div><strong>Your new API key.</strong> {newKey.expiresAt ? `Expires ${new Date(newKey.expiresAt).toLocaleString()}.` : "Never expires — until you manually revoke it."}</div>
      <div className="created-key">
        <div className="created-key-value"><KeySecret id="created-api-key" label="New API key" secret={newKey.key} visible={keyVisible} /></div>
        <KeyAction action="copy" className="button secondary key-icon-action" copied={copied === "new"} onClick={() => void copy(newKey.key, "new")} />
        <button className="button" type="button" aria-controls="created-api-key" aria-pressed={keyVisible} onClick={() => setKeyVisible(!keyVisible)}>{keyVisible ? "Hide key" : "Show key"}</button>
      </div>
    </div>}
    <section className="card" data-reveal style={{ marginTop: 18 }}><div className="section-head"><div><h2>Your keys</h2><div className="subtle">Reveal a key to view and copy it.</div></div>{!loading && <span className="pill">{keys.filter((key) => !key.revokedAt && !isKeyExpired(key.expiresAt, now)).length} active</span>}</div>
      {loadError ? <div className="error" role="alert">{loadError}</div> : loading ? <div role="status" aria-label="Loading your keys" aria-busy="true"><span className="sr-only">Loading your keys</span>{[0, 1, 2].map((id) => <div className="key-row key-skeleton" aria-hidden="true" key={id}><div><span /><span /></div><div className="skeleton-actions"><span /><span /></div></div>)}</div> : keys.length === 0 ? <div className="empty">No API keys yet. Create one above to connect your first client.</div> : [...keys].sort((a, b) => Number(Boolean(a.revokedAt)) - Number(Boolean(b.revokedAt)) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((key) => {
        const expired = isKeyExpired(key.expiresAt, now);
        const secret = key.revokedAt || !expired ? key.secret : null;
        const visible = Boolean(secret) && (Boolean(key.revokedAt) || visibleKeys.includes(key.id));
        return <div className={`key-row${key.revokedAt ? " is-revoked" : ""}`} data-visible={visible} key={key.id}><div className="key-details"><div className="key-name">{key.name}</div><div className="key-meta">{key.revokedAt ? <>Revoked <time dateTime={key.revokedAt}>{new Date(key.revokedAt).toLocaleString()}</time></> : key.expiresAt ? <>{expired ? "Expired" : "Expires"} <time dateTime={key.expiresAt}>{new Date(key.expiresAt).toLocaleString()}</time></> : "Never expires · until manually revoked"}</div><div className="key-secret-field"><KeySecret id={`key-${key.id}`} label={`${key.name} API key`} secret={secret} visible={visible} /></div></div><div className="key-actions">{key.revokedAt ? <span className="pill">revoked</span> : expired ? <><span className="pill key-expired">expired</span><KeyAction action="revoke" className="button danger key-icon-action" onClick={() => setRevokeTarget(key)} /></> : <><KeyAction action="copy" className="button secondary key-copy key-icon-action" style={{ visibility: visible && key.secret ? "visible" : "hidden" }} tabIndex={visible && key.secret ? 0 : -1} copied={copied === key.id} onClick={() => key.secret && void copy(key.secret, key.id)} /><button className="button secondary key-reveal" type="button" disabled={!key.secret} title={!key.secret ? "Create a replacement to reveal this key" : undefined} aria-controls={`key-${key.id}`} aria-pressed={visible} onClick={() => setVisibleKeys((current) => visible ? current.filter((id) => id !== key.id) : [...current, key.id])}>{visible ? "Hide key" : "Show key"}</button><KeyAction action="revoke" className="button danger key-icon-action" onClick={() => setRevokeTarget(key)} /></>}</div></div>;
      })}
    </section>
    <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && !revoking && setRevokeTarget(null)}>
      <DialogContent className="create-key-dialog revoke-dialog" showCloseButton={!revoking}>
        <DialogHeader><span className="eyebrow">API key access</span><DialogTitle>Revoke “{revokeTarget?.name}”?</DialogTitle><DialogDescription>This key will stop working immediately. Applications using it will no longer be able to access the API.</DialogDescription></DialogHeader>
        <DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={revoking}>Cancel</Button></DialogClose><Button className="button danger" type="button" onClick={() => void revoke()} disabled={revoking}>{revoking ? "Revoking…" : "Revoke key"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </TooltipProvider>;
}
