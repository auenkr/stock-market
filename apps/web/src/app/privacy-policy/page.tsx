import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = { title: "Privacy Policy | Ledgerline" };
export default function PrivacyPage() {
  return <LegalDocument title="Privacy Policy">
    <p>We respect your privacy. This policy explains how Ledgerline handles personal information when you use our website and financial data API, in accordance with applicable Indian law.</p>
    <h2>Information we collect</h2><ul><li><strong>Account details:</strong> your name, email, optional company name, and profile details supplied when you sign in with Google.</li><li><strong>Usage information:</strong> API usage, session information, IP address, browser details, and operational logs.</li><li><strong>Billing details:</strong> your subscription and payment status. Polar processes payments; we do not store your full card number.</li><li><strong>Communications:</strong> information you send us when requesting support, and records of your policy acceptance.</li></ul>
    <h2>How we use information</h2><p>We use your information to provide and secure the service, manage your account and subscriptions, process billing, respond to support requests, improve reliability, and meet legal obligations.</p>
    <h2>Cookies</h2><p>Essential cookies keep you signed in and support secure account creation. Browser storage remembers your appearance preference. Disabling essential cookies may prevent sign-in.</p>
    <h2>Data sharing</h2><p>We do not sell or rent your personal information. We share it only as needed with hosting and database providers, Google for sign-in, Polar for billing, and authorities when required by law. Providers may process information outside your country, subject to applicable safeguards.</p><p>See <a href="https://polar.sh/legal/privacy">Polar’s Privacy Policy</a> and <a href="https://policies.google.com/privacy">Google’s Privacy Policy</a>.</p>
    <h2>Security & retention</h2><p>We use reasonable safeguards to protect your information. No system is completely secure; keep your credentials private. We retain information for as long as needed to provide the service and meet legal, billing, and security obligations.</p>
    <h2>Your rights</h2><p>Subject to applicable law, you may request access, correction, or deletion of your information, withdraw consent, or raise a grievance. Contact us through the details below. Withdrawing consent may affect our ability to provide the service.</p>
    <h2>Children & updates</h2><p>Ledgerline is intended for users aged 18 and older. We will publish policy updates here and notify you of material changes through the service or your account email.</p>
  </LegalDocument>;
}
