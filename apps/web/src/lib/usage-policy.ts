import { eq } from "drizzle-orm";
import { db, user, usagePolicy } from "@stock-market/db";
import { effectivePlan, plans } from "@stock-market/db/plans";

export async function getUsagePolicy(userId: string) {
  const [account] = await db.select({ plan: user.apiPlan, expiresAt: user.planExpiresAt }).from(user).where(eq(user.id, userId));
  if (!account) throw new Error("Account is unavailable");
  const plan = effectivePlan(account.plan, account.expiresAt);
  const id = plan === "free" ? "default" : plan;
  const requestLimit = plans[plan].requestsPerMinute;
  await db.insert(usagePolicy).values({ id, requestLimit }).onConflictDoNothing();
  const [policy] = await db.select().from(usagePolicy).where(eq(usagePolicy.id, id));
  if (!policy || !Number.isInteger(policy.requestLimit) || policy.requestLimit < 1) throw new Error("Usage policy is unavailable");
  return { ...policy, plan };
}
