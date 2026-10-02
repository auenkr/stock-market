import { checkout, polar, portal, webhooks } from "@polar-sh/better-auth";
import { createPolarCore, type PolarCore } from "@polar-sh/sdk/2026-10";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { createCustomers, getStateExternalCustomers } from "@polar-sh/sdk/2026-10/services/customers";
import { billingConfig, saveCustomerState, type BillingEnvironment } from "./billing.js";
import type { Database } from "@stock-market/db";

export async function syncBillingAccount(env: BillingEnvironment, sql: Database["$client"], account: { id: string; name: string; email: string }, transport?: PolarCore) {
  const config = billingConfig(env);
  if (!config) throw new Error("Billing is not configured");
  const client = transport ?? createPolarCore({ accessToken: config.token, environment: config.environment });
  let state;
  try { state = await getStateExternalCustomers(client)(account.id); }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    // Existing Ledgerline accounts predate the signup plugin. Link them by the
    // authenticated user ID, never by user-supplied checkout metadata or email.
    // Reserved test domains are undeliverable, so those accounts use the
    // configured billing email; the same applies when the login address
    // already equals the billing email.
    const developmentEmail = env.DEV_BILLING_EMAIL?.trim();
    const reservedDomain = /\.(test|invalid|example)$|^[^@]+@localhost$/i.test(account.email);
    const developmentAccount = config.environment === "sandbox" && env.ENVIRONMENT === "dev"
      && (reservedDomain || (!!developmentEmail && account.email === developmentEmail));
    if (developmentAccount && !developmentEmail) throw new Error("Set DEV_BILLING_EMAIL to an email you own for sandbox billing.");
    await createCustomers(client)({
      email: developmentAccount ? developmentEmail! : account.email,
      name: account.name, external_id: account.id,
      ...(developmentAccount ? { metadata: { ledgerline_development_account: true } } : {}),
    });
    state = await getStateExternalCustomers(client)(account.id);
  }
  await saveCustomerState(sql, state, new Date().toISOString(), config);
  return state;
}

export function createCheckoutHook(sync: (account: { id: string; name: string; email: string }) => Promise<{ active_subscriptions: unknown[] }>) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path.startsWith("/customer/") && (ctx.query?.reference_id || ctx.query?.organizationId)) {
      throw new APIError("BAD_REQUEST", { message: "Only personal account billing is supported." });
    }
    if (ctx.path !== "/checkout") return;
    const session = await getSessionFromCtx(ctx);
    if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in before subscribing." });
    if (!session.user.profileCompleted || !session.user.termsAcceptedAt) throw new APIError("FORBIDDEN", { message: "Complete signup before subscribing." });
    if (!["personal", "professional"].includes(ctx.body?.slug) || Object.keys(ctx.body ?? {}).some((key) => !["slug", "redirect"].includes(key))) {
      throw new APIError("BAD_REQUEST", { message: "Choose a supported monthly plan." });
    }
    const state = await sync(session.user);
    if (state.active_subscriptions.length) throw new APIError("CONFLICT", { message: "Manage your existing subscription in the billing portal." });
    ctx.body.allow_trial = false;
  });
}

export function createBillingPlugin(env: BillingEnvironment, sql: Database["$client"], baseURL: string, transport?: PolarCore) {
  const config = billingConfig(env);
  if (!config) return null;
  const client = transport ?? createPolarCore({ accessToken: config.token, environment: config.environment });
  const syncSubscription = async (payload: { timestamp: string; data: { customer: { external_id?: string | null } } }) => {
    if (!payload.data.customer.external_id) return;
    // Read current state, rather than trusting a delayed subscription event.
    const state = await getStateExternalCustomers(client)(payload.data.customer.external_id);
    await saveCustomerState(sql, state, payload.timestamp, config);
  };
  return polar({
    client, createCustomerOnSignUp: true,
    use: [
      checkout({ products: [{ productId: config.personal, slug: "personal" }, { productId: config.professional, slug: "professional" }],
        authenticatedUsersOnly: true, successUrl: new URL("/dashboard/billing?checkout=success", baseURL).href, returnUrl: new URL("/dashboard/billing", baseURL).href }),
      portal({ returnUrl: new URL("/dashboard/billing", baseURL).href }),
      webhooks({ secret: config.secret,
        onCustomerStateChanged: async (payload) => { await saveCustomerState(sql, payload.data, payload.timestamp, config); },
        onSubscriptionActive: syncSubscription, onSubscriptionUpdated: syncSubscription,
        onSubscriptionCanceled: syncSubscription, onSubscriptionRevoked: syncSubscription,
        onSubscriptionPastDue: syncSubscription, onSubscriptionPaused: syncSubscription,
        onSubscriptionResumed: syncSubscription, onSubscriptionCycled: syncSubscription,
      }),
    ],
  });
}
