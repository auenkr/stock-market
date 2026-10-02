import Link from "next/link";
import type { Metadata } from "next";
import { ThemePicker } from "@/components/theme-picker";
import { PlanCards } from "@/components/plan-cards";
import "../pricing.css";

export const metadata: Metadata = { title: "Monthly API plans | Ledgerline", description: "Basic is free. Personal is ₹2,000/month at 300 requests/minute. Professional is ₹5,000/month at 500 requests/minute with commercial use." };
export default function PricingPage() {
  return <main className="pricing-page"><header className="legal-header"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link><nav><Link href="/documentation">Documentation</Link><Link href="/signin">Sign in</Link><ThemePicker /></nav></header>
    <section className="pricing-hero"><span className="eyebrow">SIMPLE PLANS. ROOM TO BUILD.</span><h1>Your data. Your pace.</h1><p className="subtle">Start free, unlock every endpoint for personal research, or take your product commercial.</p><span className="pill">Billed monthly · No annual commitment</span></section>
    <PlanCards /><section className="card pricing-notes"><h2>A few details, upfront.</h2><p>Paid subscriptions renew monthly through Polar, our merchant of record. Applicable taxes are shown at checkout. Basic stays free and does not require a payment subscription.</p><p>Personal and Professional unlock access to every documented endpoint. Source coverage still applies: missing fields may be null and unavailable datasets return 501. Review the <Link href="/docs">API reference</Link> before subscribing.</p><p>Professional permits commercial integration into your applications. It does not permit reselling the raw data, sharing credentials, or sublicensing the API. Cancel or change your plan in the billing portal; access continues through the paid period for end-of-period cancellations.</p></section>
    <footer className="legal-footer"><Link href="/terms-of-service">Terms of Service</Link><Link href="/privacy-policy">Privacy Policy</Link><Link href="/">Back to Ledgerline</Link></footer></main>;
}
