import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { db } from "@stock-market/db";
import { createAuthOptions } from "./config.js";
import { createBillingPlugin, createCheckoutHook, syncBillingAccount } from "./polar.js";

const options = createAuthOptions(process.env);

export const authBaseURL = options.baseURL;
export const isGoogleAuthEnabled = Boolean(options.socialProviders.google);
export const isDevAuthEnabled = options.emailAndPassword.enabled;
const billing = createBillingPlugin(process.env, db.$client, options.baseURL);
export const isBillingEnabled = Boolean(billing);
export const syncAccountBilling = (account: { id: string; name: string; email: string }) => syncBillingAccount(process.env, db.$client, account);

export const auth = betterAuth({
  ...options,
  database: drizzleAdapter(db, { provider: "pg" }),
  plugins: billing ? [billing] : [],
  hooks: { before: createCheckoutHook(syncAccountBilling) },
});

export type Auth = typeof auth;
