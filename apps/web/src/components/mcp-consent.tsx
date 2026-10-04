"use client";

import { useEffect, useState } from "react";
import { Button } from "@stock-market/ui/components/button";
import { authClient } from "@/lib/auth-client";

export function McpConsent({ clientName, scopes }: { clientName: string; scopes: string[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  async function consent(accept: boolean) {
    setPending(true);
    setError("");
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error || !result.data?.url) throw new Error(result.error?.message || "Connection could not be completed.");
      window.location.assign(result.data.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Connection could not be completed.");
      setPending(false);
    }
  }
  const labels: Record<string, string> = {
    "openid": "Identify your Ledgerline account",
    "email": "Read your verified account email",
    "offline_access": "Keep the connection active between visits",
    "market:read": "Read company fundamentals using your account's access and shared request allowance",
  };
  return <section className="auth-card card"><h1>Connect {clientName}</h1><p>Allow this application to access Ledgerline on your behalf:</p><ul>{scopes.map(scope => <li key={scope}>{labels[scope] || scope}</li>)}</ul><p>The connection cannot trade, change your subscription, or make payments. You can revoke its API key in your Ledgerline dashboard.</p>{error && <p role="alert">{error}</p>}<div className="flex gap-3"><Button disabled={!ready || pending} onClick={() => void consent(true)}>Allow connection</Button><Button variant="outline" disabled={!ready || pending} onClick={() => void consent(false)}>Cancel</Button></div></section>;
}
