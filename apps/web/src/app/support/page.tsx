import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Support | Ledgerline", description: "Get help with Ledgerline API integration, your account, subscriptions, and privacy requests." };
export default function SupportPage() {
  const email = process.env.SUPPORT_EMAIL || process.env.LEGAL_CONTACT_EMAIL;
  return <PublicPage><div className="support-page">
    <section className="pricing-hero"><span className="eyebrow">LEDGERLINE / SUPPORT</span><h1>A little help.<br /><em>Back to building.</em></h1><p className="subtle">Find an answer, troubleshoot a request, or get help with your account.</p></section>
    <div className="support-grid"><section className="card"><span className="eyebrow">01 / DEVELOPERS</span><h2>API & integration</h2><p className="subtle">Explore endpoints, request examples, and data coverage.</p><Link className="inline-link" href="/docs">Open the API reference →</Link></section><section className="card"><span className="eyebrow">02 / YOUR ACCOUNT</span><h2>Plans & payments</h2><p className="subtle">Manage your subscription, payment details, and invoices.</p><Link className="inline-link" href="/dashboard/billing">Go to billing →</Link></section></div>
    <section className="support-contact card"><span className="eyebrow">LET’S SORT IT OUT</span><h2>Contact support</h2><p className="subtle">For integration issues, include the endpoint, response status, and request ID if available. Never include passwords, API keys, or payment details.</p>{email ? <><a className="button secondary" href={`mailto:${email}`}>Email support</a><p className="subtle">{email}</p><p className="subtle">You can also contact us for account help, privacy requests, and grievances.</p></> : <><a className="button secondary" href="https://github.com/AuenKr/stock-market/issues">Report a technical issue</a><p className="subtle">The issue tracker is public. For private account or payment questions, use the contact details on your billing receipt. Do not post personal information in an issue.</p></>}</section>
  </div></PublicPage>;
}
