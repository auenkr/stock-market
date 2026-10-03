import { createHmac, randomUUID } from "node:crypto";

export const productIds = { basic: "66666666-6666-4666-8666-666666666666", personal: "11111111-1111-4111-8111-111111111111", professional: "22222222-2222-4222-8222-222222222222" };
export const webhookSecret = "billing-test-webhook-secret";
export const billingTestEnvironment = {
  POLAR_ACCESS_TOKEN: "test-polar-token", POLAR_WEBHOOK_SECRET: webhookSecret,
  POLAR_SANDBOX_BASIC_PRODUCT_ID: productIds.basic,
  POLAR_SANDBOX_PERSONAL_PRODUCT_ID: productIds.personal, POLAR_SANDBOX_PROFESSIONAL_PRODUCT_ID: productIds.professional,
  ENVIRONMENT: "dev",
};

export function customerState(userId: string, plan: "free" | "basic" | "personal" | "professional", options: { status?: string; expires?: string; cancelAtPeriodEnd?: boolean; interval?: string } = {}) {
  const now = new Date().toISOString();
  return {
    id: "33333333-3333-4333-8333-333333333333", external_id: userId, created_at: now, modified_at: now,
    type: "individual", email: "dev@auenkr.com", email_verified: true, name: "Billing Tester", metadata: {},
    billing_name: null, billing_address: null, tax_id: null, deleted_at: null, first_user_event_at: null, avatar_url: null,
    organization_id: "44444444-4444-4444-8444-444444444444", granted_benefits: [], active_meters: [],
    active_subscriptions: plan === "free" ? [] : [{
      id: "55555555-5555-4555-8555-555555555555", created_at: now, modified_at: now, metadata: {},
      status: options.status || "active", amount: { basic: 19900, personal: 39900, professional: 249900 }[plan], currency: "inr",
      recurring_interval: options.interval || "month", current_period_start: now,
      current_period_end: options.expires || new Date(Date.now() + 86400_000 * 30).toISOString(),
      trial_start: null, trial_end: null, cancel_at_period_end: options.cancelAtPeriodEnd || false,
      canceled_at: options.cancelAtPeriodEnd ? now : null, started_at: now, ends_at: null,
      product_id: productIds[plan], discount_id: null, seats: null, units: null, meters: [],
    }],
  };
}

export function signedEvent(data: unknown, timestamp = new Date().toISOString(), type = "customer.state_changed") {
  const body = JSON.stringify({ type, timestamp, data });
  const id = randomUUID();
  const time = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSecret).update(`${id}.${time}.${body}`).digest("base64");
  return { body, headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": time, "webhook-signature": `v1,${signature}` } };
}
