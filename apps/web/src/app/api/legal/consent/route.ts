import { auth, authBaseURL } from "@stock-market/auth";
import { createConsentHandler, legalVersion } from "@stock-market/auth/consent";
import { db, user } from "@stock-market/db";
import { and, eq, isNull } from "drizzle-orm";

const recordConsent = createConsentHandler(process.env.BETTER_AUTH_SECRET || "stock-market-local-development-secret", authBaseURL);
export async function POST(request: Request) {
  const result = await recordConsent(request);
  if (!result.ok) return result;
  const session = await auth.api.getSession({ headers: request.headers });
  if (session) await db.update(user).set({ termsAcceptedAt: new Date(), termsVersion: legalVersion, privacyVersion: legalVersion, updatedAt: new Date() })
    .where(and(eq(user.id, session.user.id), isNull(user.termsAcceptedAt)));
  return result;
}
