import { eq } from "drizzle-orm";
import { db, usagePolicy } from "@stock-market/db";

export async function getUsagePolicy() {
  await db.insert(usagePolicy).values({ id: "default" }).onConflictDoNothing();
  const [policy] = await db.select().from(usagePolicy).where(eq(usagePolicy.id, "default"));
  if (!policy || !Number.isInteger(policy.requestLimit) || policy.requestLimit < 1) {
    throw new Error("Usage policy is unavailable");
  }
  return policy;
}
