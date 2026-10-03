import { headers } from "next/headers";
import { auth } from "@stock-market/auth";
import { db, user } from "@stock-market/db";
import { effectivePlan, plans } from "@stock-market/db/plans";
import { eq } from "drizzle-orm";

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { name, email, company } = session.user;
  const [account] = await db.select().from(user).where(eq(user.id, session.user.id));
  if (!account) return null;
  const current = effectivePlan(account.apiPlan, account.planExpiresAt);

  return <>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">Account</span><h1>Your profile.</h1><p className="subtle">The details associated with your Ledgerline account.</p></div></section>
    <section className="card profile-card"><div className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div><div className="profile-details">
      <div><span className="eyebrow">Full name</span><strong>{name}</strong></div>
      <div><span className="eyebrow">Email address</span><strong>{email}</strong></div>
      <div><span className="eyebrow">Company</span><strong>{company || "Not provided"}</strong></div>
      <div><span className="eyebrow">Current plan</span><strong>{plans[current].name}</strong></div>
    </div></section>
  </>;
}
