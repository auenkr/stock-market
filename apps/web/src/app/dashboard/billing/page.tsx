import { headers } from "next/headers";
import Link from "next/link";
import { auth, isBillingEnabled } from "@stock-market/auth";
import { db, user } from "@stock-market/db";
import { eq } from "drizzle-orm";
import { effectivePlan, plans } from "@stock-market/db/plans";
import { BillingControls } from "@/components/billing-controls";
import "../../pricing.css";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const [account] = await db.select().from(user).where(eq(user.id, session.user.id));
  if (!account) return null;
  const current = effectivePlan(account.apiPlan, account.planExpiresAt);
  const currentPlan = plans[current];
  const { checkout } = await searchParams;
  return <><section className="hero"><div className="hero-copy"><span className="eyebrow">Subscription & billing</span><h1>A plan for your next step.</h1><p className="subtle">Your current plan is <strong>{currentPlan.name}</strong>. {currentPlan.monthlyPrice === 0 ? <strong>Free forever. No credit card required.</strong> : <><strong>₹{currentPlan.monthlyPrice.toLocaleString("en-IN")} / month</strong> before applicable taxes.</>}</p><p className="subtle"><strong>{currentPlan.requestsPerMinute} requests / minute</strong>, shared across your API keys, REST and agent integrations. Paid plans renew monthly; cancel anytime.</p></div></section>
    {checkout === "success" && <p className="subtle" role="status">Checkout completed. Your plan activates after Polar confirms payment.</p>}
    <BillingControls current={current} enabled={isBillingEnabled} hasCustomer={Boolean(account.polarCustomerId)} consentRecorded={Boolean(account.termsAcceptedAt)} paidAccessThrough={current !== "free" && account.planExpiresAt ? account.planExpiresAt.toLocaleDateString("en-IN", { timeZone: "UTC" }) : undefined} />
    <p className="subtle billing-help"><strong>Secure payments through Polar.</strong> Taxes are shown at checkout. <Link href="/support">Need help?</Link> · <Link href="/terms-of-service">Terms</Link> · <Link href="/privacy-policy">Privacy</Link></p></>;
}
