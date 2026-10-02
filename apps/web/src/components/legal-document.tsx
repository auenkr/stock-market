import Link from "next/link";
import { legalVersion } from "@stock-market/auth/consent";
import { ThemePicker } from "./theme-picker";
import "../app/pricing.css";

export function LegalDocument({ title, children }: { title: string; children: React.ReactNode }) {
  const contact = process.env.LEGAL_CONTACT_EMAIL;
  return <main className="legal-page"><header className="legal-header"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link><nav><Link href="/pricing">Pricing</Link><Link href="/signup">Sign up</Link><ThemePicker /></nav></header>
    <article className="legal-body"><span className="eyebrow">LEDGERLINE / LEGAL</span><h1>{title}</h1><p className="subtle">Effective date and policy version: {legalVersion}</p>{children}
      <h2>Contact</h2><p>{process.env.LEGAL_ENTITY_NAME || "Ledgerline"}{process.env.LEGAL_ADDRESS ? ` — ${process.env.LEGAL_ADDRESS}` : ""}.</p><p>For account, legal, privacy, and grievance requests, {contact ? <a href={`mailto:${contact}`}>{contact}</a> : <a href="https://github.com/AuenKr/stock-market/issues">contact the Ledgerline operator through our support page</a>}. Do not post private account details in a public issue.</p>
    </article><footer className="legal-footer"><Link href="/terms-of-service">Terms of Service</Link><Link href="/privacy-policy">Privacy Policy</Link><Link href="/pricing">Pricing</Link></footer></main>;
}
