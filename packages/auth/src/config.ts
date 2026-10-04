import type { BetterAuthOptions } from "better-auth";
import { createId } from "@stock-market/db/id";
import { consentUserHook } from "./consent.js";

type AuthEnvironment = Record<string, string | undefined>;

export function createAuthOptions(env: AuthEnvironment) {
  const port = env.WEB_PORT?.trim() || "3001";
  const baseURL = env.BETTER_AUTH_URL?.trim() || `http://localhost:${port}`;
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const trustedOrigins = [
    new URL(baseURL).origin,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...(env.WEB_URL?.split(",").map((url) => url.trim()).filter(Boolean) ?? []),
  ];

  return {
    baseURL,
    secret: env.BETTER_AUTH_SECRET || (
      env.NODE_ENV === "production" ? undefined : "stock-market-local-development-secret"
    ),
    trustedOrigins: [...new Set(trustedOrigins)],
    advanced: { database: { generateId: createId } },
    // Credential accounts are provisioned by the admin CLI, never public signup.
    emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: true },
    socialProviders: clientId && clientSecret ? {
      google: { clientId, clientSecret },
    } : {},
    user: {
      additionalFields: {
        company: { type: "string", required: false, input: false },
        profileCompleted: {
          type: "boolean", required: false, defaultValue: false, input: false,
        },
        termsAcceptedAt: { type: "date", required: false, input: false },
        termsVersion: { type: "string", required: false, input: false },
        privacyVersion: { type: "string", required: false, input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    databaseHooks: { user: { create: { before: consentUserHook(env.BETTER_AUTH_SECRET || "stock-market-local-development-secret") } } },
  } as const satisfies BetterAuthOptions;
}
