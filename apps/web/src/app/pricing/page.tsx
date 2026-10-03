import Link from "next/link";
import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";
import { PlanCards } from "@/components/plan-cards";

export const metadata: Metadata = { title: "Monthly API plans | Ledgerline", description: "Hobby is free, no credit card. Basic ₹199/month, Personal ₹399/month, Professional ₹2,499/month. Indian company data for applications and AI tools." };
export default function PricingPage() {
  return <PublicPage><div className="pricing-page">
    <section className="pricing-hero"><span className="eyebrow">SIMPLE PLANS. ROOM TO BUILD.</span><h1>Your data. <em>Your pace.</em></h1><p className="subtle">Start with Hobby, free without a credit card. Choose Basic for company essentials, Personal for deeper research, or Professional for your business.</p><span className="pill">Monthly billing · Cancel anytime</span></section>
    <PlanCards />
    <section className="pricing-notes"><h2>A few details, upfront.</h2><ul><li>Paid plans renew monthly. Taxes are shown at checkout.</li><li>Cancel anytime; keep access until your paid period ends.</li><li>Commercial use requires Professional. Reselling data is prohibited.</li></ul><p>Questions? <Link href="/support">Talk to support</Link>. See our <Link href="/terms-of-service">terms</Link> for details.</p></section>
  </div></PublicPage>;
}
