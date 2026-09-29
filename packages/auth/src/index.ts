import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { db } from "@stock-market/db";

const trustedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.WEB_URL?.split(",").map((url) => url.trim()).filter(Boolean) ?? []),
];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: process.env.DB_CONNECTION_URL ?? "stock-market-local-development-secret",
  trustedOrigins: [...new Set(trustedOrigins)],
  emailAndPassword: { enabled: true },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
});

export type Auth = typeof auth;
