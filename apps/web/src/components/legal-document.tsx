import Link from "next/link";
import { legalVersion } from "@stock-market/auth/consent";
import { PublicPage } from "./public-page";

export function LegalDocument({ title, children }: { title: string; children: React.ReactNode }) {
  const contact = process.env.LEGAL_CONTACT_EMAIL;
  return <PublicPage>
    <article className="legal-body"><span className="eyebrow">LEDGERLINE / LEGAL</span><h1>{title}</h1><p className="subtle">Last updated {legalVersion}</p>{children}
      <h2>Contact & grievances</h2><p>{process.env.LEGAL_ENTITY_NAME || "Ledgerline"}{process.env.LEGAL_ADDRESS ? ` — ${process.env.LEGAL_ADDRESS}` : ""}.</p><p>For questions, privacy requests, or grievances, {contact ? <>email <a href={`mailto:${contact}`}>{contact}</a></> : <>visit our <Link href="/support">support page</Link></>}.</p>
    </article></PublicPage>;
}
