"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { PlanCards } from "./plan-cards";
import type { ApiPlan } from "@stock-market/db/plans";

export function BillingControls({ current, enabled, hasCustomer, consentRecorded, paidAccessThrough }: { current: ApiPlan; enabled: boolean; hasCustomer: boolean; consentRecorded: boolean; paidAccessThrough?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const router = useRouter();
  async function acceptTerms() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/legal/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted }) });
      if (!response.ok) throw new Error("Could not record consent.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record consent."); }
    finally { setPending(false); }
  }
  async function checkout(slug: "personal" | "professional") {
    setPending(true); setError("");
    try {
      const result = await authClient.checkout({ slug });
      if (result.error) throw new Error(result.error.message || "Could not open checkout.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect to billing."); setPending(false); }
  }
  async function portal() {
    setPending(true); setError("");
    try {
      const result = await authClient.customer.portal();
      if (result.error) throw new Error(result.error.message || "Could not open the billing portal.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect to billing."); setPending(false); }
  }
  return <>{(paidAccessThrough || hasCustomer) && <section className="billing-summary">
      {paidAccessThrough && <p className="subtle">Current paid access through <strong>{paidAccessThrough}</strong>. Manage renewals, plan changes, payment details, and cancellations in <strong>Polar</strong>.</p>}
      {hasCustomer && <div className="billing-actions"><button className="button outline" disabled={!enabled || pending} onClick={() => void portal()}>Manage subscription & invoices</button></div>}
    </section>}
    {!enabled && <p className="subtle" role="status">Paid subscriptions are not available yet. Basic access is ready to use.</p>}
    {!consentRecorded && <section className="card"><p>Before subscribing, please accept our current policies.</p><label className="legal-consent"><input type="checkbox" checked={accepted} disabled={!ready || pending} onChange={(event) => setAccepted(event.target.checked)} /><span>I agree to the <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</Link> and <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.</span></label><button className="button secondary" disabled={!accepted || pending} onClick={() => void acceptTerms()}>Accept policies</button></section>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="billing-plans"><PlanCards current={current} action={(plan) => <button className="button secondary" type="button" disabled={!enabled || pending || !consentRecorded} onClick={() => void (current === "free" ? checkout(plan) : portal())}>{pending ? "Please wait…" : current === "free" ? `Subscribe to ${plan === "personal" ? "Personal" : "Professional"}` : "Change plan in Polar"}</button>} /></div></>;
}
