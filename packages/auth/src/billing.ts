import type { Database } from "@stock-market/db";
import type { ApiPlan, PaidApiPlan } from "@stock-market/db/plans";

type BillingProducts = Record<PaidApiPlan, string>;

export type BillingEnvironment = Record<string, string | undefined>;
const defaultProducts = {
  sandbox: {
    basic: "64c26c52-74bb-4f3f-8025-66e9d2c62637",
    personal: "99588bd8-83cc-436c-b5b3-1afb0ac6ddfd",
    professional: "5e946fcd-51e1-41e1-a32e-a2444d06ed6d",
  },
  production: {
    basic: "9e5e9c9a-3b60-42b2-b7ab-f6e769ad5ed8",
    personal: "6a7edd2a-7a21-4464-a4f0-96a9f566f23b",
    professional: "f803d30f-8c17-4b14-ab0c-4067f24e04cd",
  },
} as const;

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
  const appEnvironment = env.ENVIRONMENT?.trim() || "dev";
  if (appEnvironment !== "dev" && appEnvironment !== "production") throw new Error("ENVIRONMENT must be dev or production for Polar billing");
  const environment: "production" | "sandbox" = appEnvironment === "production" ? "production" : "sandbox";
  const prefix = environment === "production" ? "POLAR_PRODUCTION" : "POLAR_SANDBOX";
  const defaults = defaultProducts[environment];
  const basic = env[`${prefix}_BASIC_PRODUCT_ID`]?.trim() || defaults.basic;
  const personal = env[`${prefix}_PERSONAL_PRODUCT_ID`]?.trim() || defaults.personal;
  const professional = env[`${prefix}_PROFESSIONAL_PRODUCT_ID`]?.trim() || defaults.professional;
  if (![token, secret, basic, personal, professional].some(Boolean)) return null;
  if (!token || !secret || !basic || !personal || !professional) {
    // Preview deployments may inherit only part of the production settings.
    // Keep checkout unavailable instead of crashing unrelated pages at build time.
    // Next.js imports route modules while collecting page data. A developer's
    // partial local .env must not prevent that build; the same config is checked
    // again when the server starts and incomplete billing still fails there.
    if (env.VERCEL_ENV === "preview" || env.NEXT_PHASE === "phase-production-build") {
      if (env.VERCEL_ENV === "preview") console.warn("Polar billing is disabled in this Vercel Preview: both credentials and all three product IDs are required.");
      return null;
    }
    throw new Error("Set both Polar credentials and all three product IDs to enable billing");
  }
  if (new Set([basic, personal, professional]).size !== 3) throw new Error("Polar plan product IDs must be different");
  return { token, secret, basic, personal, professional, environment };
}

export function resolveEntitlement(state: CustomerState, products: BillingProducts, now = new Date()) {
  let plan: ApiPlan = "free";
  let expiresAt: Date | null = null;
  for (const subscription of state.active_subscriptions) {
    const tier = (["basic", "personal", "professional"] as const).find((plan) => products[plan] === subscription.product_id);
    if (!tier || subscription.recurring_interval !== "month") continue;
    if (subscription.status !== "active" && !(subscription.status === "canceled" && subscription.cancel_at_period_end)) continue;
    const end = new Date(subscription.current_period_end);
    const expires = subscription.ends_at ? new Date(Math.min(end.getTime(), new Date(subscription.ends_at).getTime())) : end;
    if (!Number.isFinite(expires.getTime()) || expires <= now) continue;
    const rank = { free: 0, basic: 1, personal: 2, professional: 3 };
    if (rank[tier] > rank[plan] || (tier === plan && expires > expiresAt!)) {
      plan = tier; expiresAt = expires;
    }
  }
  return { plan, expiresAt };
}

/** A timestamp guard makes duplicate and out-of-order webhook delivery harmless. */
export async function saveCustomerState(sql: Database["$client"], state: CustomerState, timestamp: string, products: BillingProducts) {
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
