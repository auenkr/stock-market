import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { createMcpOAuthPlugin } from "./mcp-config.js";
import { mcpAccountAccess } from "./mcp-access.js";
import { db } from "@stock-market/db";
import { createAuthOptions } from "./config.js";
import { createBillingPlugin, createCheckoutHook, syncBillingAccount } from "./polar.js";

const options = createAuthOptions(process.env);

export const authBaseURL = options.baseURL;
export const isGoogleAuthEnabled = Boolean(options.socialProviders.google);
export const isDevAuthEnabled = process.env.ENVIRONMENT === "dev";
const billing = createBillingPlugin(process.env, db.$client, options.baseURL);
export const isBillingEnabled = Boolean(billing);
export const syncAccountBilling = (account: { id: string; name: string; email: string }) => syncBillingAccount(process.env, db.$client, account);

export const auth = betterAuth({
  ...options,
  database: drizzleAdapter(db, { provider: "pg" }),
  disabledPaths: ["/token"],
  plugins: [jwt(), createMcpOAuthPlugin(), mcpAccountAccess(), ...(billing ? [billing] : [])],
  hooks: { before: createCheckoutHook(syncAccountBilling) },
});

export type Auth = typeof auth;
