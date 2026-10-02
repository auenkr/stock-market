import type { BetterAuthOptions } from "better-auth";
import { createId } from "@stock-market/db/id";

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
    emailAndPassword: { enabled: env.ENVIRONMENT === "dev", disableSignUp: true },
    socialProviders: clientId && clientSecret ? {
      google: { clientId, clientSecret },
    } : {},
    user: {
      additionalFields: {
        company: { type: "string", required: false, input: false },
        profileCompleted: {
          type: "boolean", required: false, defaultValue: false, input: false,
        },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  } as const satisfies BetterAuthOptions;
}
