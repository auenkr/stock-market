import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { db } from "@stock-market/db";
import { createAuthOptions } from "./config.js";

const options = createAuthOptions(process.env);

export const authBaseURL = options.baseURL;
export const isGoogleAuthEnabled = Boolean(options.socialProviders.google);
export const isDevAuthEnabled = options.emailAndPassword.enabled;

export const auth = betterAuth({
  ...options,
  database: drizzleAdapter(db, { provider: "pg" }),
});

export type Auth = typeof auth;
