import { eq } from "drizzle-orm";
import { db, user, usagePolicy } from "@stock-market/db";

export async function getUsagePolicy(userId: string) {
  const [account] = await db.select({ plan: user.apiPlan }).from(user).where(eq(user.id, userId));
  if (!account) throw new Error("Account is unavailable");
  const id = account.plan === "paid" ? "paid" : "default";
  const requestLimit = account.plan === "paid" ? 60 : 10;
  await db.insert(usagePolicy).values({ id, requestLimit }).onConflictDoNothing();
  const [policy] = await db.select().from(usagePolicy).where(eq(usagePolicy.id, id));
  if (!policy || !Number.isInteger(policy.requestLimit) || policy.requestLimit < 1) throw new Error("Usage policy is unavailable");
  return { ...policy, plan: account.plan };
}
