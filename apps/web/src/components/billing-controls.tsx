"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { PlanCards } from "./plan-cards";
import { plans, type ApiPlan, type PaidApiPlan } from "@stock-market/db/plans";

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
  async function checkout(slug: PaidApiPlan) {
    setPending(true); setError("");
    try {
      const result = await authClient.checkout({ slug });
      if (result.error) throw new Error(result.error.message || "Could not open checkout.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect to billing."); setPending(false); }
  }
  async function portal() {
    // Open during the click gesture so the browser does not block the tab
    // after the asynchronous authenticated portal request finishes.
    const billingTab = window.open("about:blank", "_blank");
    if (!billingTab) { setError("Allow pop-ups to open the billing portal in a new tab."); return; }
    billingTab.opener = null;
    setPending(true); setError("");
    try {
      const result = await authClient.customer.portal({ redirect: false });
      if (result.error) throw new Error(result.error.message || "Could not open the billing portal.");
      if (!result.data?.url) throw new Error("Could not open the billing portal.");
      billingTab.location.href = result.data.url;
    } catch (e) { billingTab.close(); setError(e instanceof Error ? e.message : "Could not connect to billing."); }
    finally { setPending(false); }
  }
  return <>{(paidAccessThrough || hasCustomer) && <section className="billing-summary">
      {paidAccessThrough && <p className="subtle">Current paid access through <strong>{paidAccessThrough}</strong>. Manage renewals, plan changes, payment details, and cancellations in <strong>Polar</strong>.</p>}
      {hasCustomer && <div className="billing-actions"><button className="button outline" disabled={!enabled || pending} onClick={() => void portal()}>Manage subscription & invoices</button></div>}
    </section>}
    {!enabled && <p className="subtle" role="status">Paid subscriptions are not available yet. Hobby access is ready to use without a credit card.</p>}
    {!consentRecorded && <section className="card"><p>Before subscribing, please accept our current policies.</p><label className="legal-consent"><input type="checkbox" checked={accepted} disabled={!ready || pending} onChange={(event) => setAccepted(event.target.checked)} /><span>I agree to the <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</Link> and <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.</span></label><button className="button secondary" disabled={!accepted || pending} onClick={() => void acceptTerms()}>Accept policies</button></section>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="billing-plans"><PlanCards current={current} action={(plan) => <button className="button secondary" type="button" disabled={!enabled || pending || !consentRecorded} onClick={() => void (current === "free" ? checkout(plan) : portal())}>{pending ? "Please wait…" : current === "free" ? `Subscribe to ${plans[plan].name}` : "Change plan in Polar"}</button>} /></div></>;
}
