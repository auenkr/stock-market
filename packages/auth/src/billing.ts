import type { Database } from "@stock-market/db";
import type { ApiPlan } from "@stock-market/db/plans";

export type BillingEnvironment = Record<string, string | undefined>;
export type CustomerState = {
  id: string;
  external_id?: string | null;
  active_subscriptions: {
    product_id: string; status: string; recurring_interval: string;
    current_period_end: string; ends_at: string | null; cancel_at_period_end: boolean;
  }[];
};

export function billingConfig(env: BillingEnvironment) {
  const token = env.POLAR_ACCESS_TOKEN?.trim();
  const secret = env.POLAR_WEBHOOK_SECRET?.trim();
  const personal = env.POLAR_PERSONAL_PRODUCT_ID?.trim();
  const professional = env.POLAR_PROFESSIONAL_PRODUCT_ID?.trim();
  const environment = env.POLAR_ENVIRONMENT?.trim() || "sandbox";
  if (!["sandbox", "production"].includes(environment)) throw new Error("POLAR_ENVIRONMENT must be sandbox or production");
  if (![token, secret, personal, professional].some(Boolean)) return null;
  if (!token || !secret || !personal || !professional) throw new Error("Set all four Polar credentials/product IDs to enable billing");
  if (personal === professional) throw new Error("Polar plan product IDs must be different");
  return { token, secret, personal, professional, environment: environment as "sandbox" | "production" };
}

export function resolveEntitlement(state: CustomerState, products: { personal: string; professional: string }, now = new Date()) {
  let plan: ApiPlan = "free";
  let expiresAt: Date | null = null;
  for (const subscription of state.active_subscriptions) {
    const tier = subscription.product_id === products.professional ? "professional" : subscription.product_id === products.personal ? "personal" : null;
    if (!tier || subscription.recurring_interval !== "month") continue;
    if (subscription.status !== "active" && !(subscription.status === "canceled" && subscription.cancel_at_period_end)) continue;
    const end = new Date(subscription.current_period_end);
    const expires = subscription.ends_at ? new Date(Math.min(end.getTime(), new Date(subscription.ends_at).getTime())) : end;
    if (!Number.isFinite(expires.getTime()) || expires <= now) continue;
    if (plan === "free" || (tier === "professional" && plan === "personal") || (tier === plan && expires > expiresAt!)) {
      plan = tier; expiresAt = expires;
    }
  }
  return { plan, expiresAt };
}

/** A timestamp guard makes duplicate and out-of-order webhook delivery harmless. */
export async function saveCustomerState(sql: Database["$client"], state: CustomerState, timestamp: string, products: { personal: string; professional: string }) {
  if (!state || typeof state.id !== "string" || !Array.isArray(state.active_subscriptions)) throw new Error("Invalid customer state");
  if (!state.external_id) return;
  const updatedAt = new Date(timestamp);
  if (!Number.isFinite(updatedAt.getTime())) throw new Error("Invalid billing event timestamp");
  const { plan, expiresAt } = resolveEntitlement(state, products);
  await sql`UPDATE "user" SET api_plan = ${plan}, plan_expires_at = ${expiresAt?.toISOString() ?? null},
    polar_customer_id = ${state.id}, billing_updated_at = ${updatedAt.toISOString()}, updated_at = now()
    WHERE id = ${state.external_id} AND (billing_updated_at IS NULL OR billing_updated_at <= ${updatedAt.toISOString()})
      AND (polar_customer_id IS NULL OR polar_customer_id = ${state.id})`;
}
