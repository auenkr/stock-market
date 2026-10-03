import { createHmac, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";

export const legalVersion = "2026-10-03";
export const consentCookieName = "ledgerline.legal-consent";
const maxAge = 30 * 60;

export function signConsent(secret: string, now = Date.now()) {
  const value = `${legalVersion}.${now}`;
  return `${value}.${createHmac("sha256", secret).update(value).digest("hex")}`;
}

export function verifyConsent(cookie: string | null | undefined, secret: string, now = Date.now()) {
  const token = cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${consentCookieName}=`))?.slice(consentCookieName.length + 1);
  if (!token) return false;
  const [version, time, signature] = token.split(".");
  if (version !== legalVersion || !time || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const age = now - Number(time);
  if (!Number.isFinite(age) || age < 0 || age > maxAge * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${version}.${time}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function consentUserHook(secret: string) {
  return async (user: Record<string, unknown>, context: { headers?: Headers } | null) => {
    if (!verifyConsent(context?.headers?.get("cookie"), secret)) {
      throw new APIError("FORBIDDEN", { code: "LEGAL_CONSENT_REQUIRED", message: "Agree to the Terms of Service and Privacy Policy on the signup page first." });
    }
    return { data: { ...user, termsAcceptedAt: new Date(), termsVersion: legalVersion, privacyVersion: legalVersion } };
  };
}

export function createConsentHandler(secret: string, baseURL: string) {
  return async (request: Request) => {
    const origin = request.headers.get("origin");
    if (!origin || (origin !== new URL(request.url).origin && origin !== new URL(baseURL).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return Response.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { accepted?: unknown } | null;
    if (body?.accepted !== true) return Response.json({ error: "You must agree to both policies." }, { status: 400 });
    const secure = new URL(baseURL).protocol === "https:" ? "; Secure" : "";
    return Response.json({ ok: true }, { headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": `${consentCookieName}=${signConsent(secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`,
    } });
  };
}
