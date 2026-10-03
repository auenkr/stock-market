import postgres from "postgres";
import type { ApiPlan } from "./plans.js";
export type { ApiPlan } from "./plans.js";

export type AccessDecision = { status: "allowed"; plan: ApiPlan } | { status: "unauthorized" } | { status: "unavailable" } | { status: "limited"; retryAfter: number };
export type AccountAccessBindings = { DB_CONNECTION_URL?: string; ACCOUNT_SERVICE_URL?: string; ACCOUNT_SERVICE_SECRET?: string };
export type AuthorizeRequest = (secret: string | undefined, bindings: AccountAccessBindings, sharedSql?: postgres.Sql) => Promise<AccessDecision>;

async function authorizeViaService(secret: string, bindings: AccountAccessBindings): Promise<AccessDecision> {
  if (!bindings.ACCOUNT_SERVICE_SECRET) return { status: "unavailable" };
  try {
    const body = JSON.stringify({ key: secret });
    const timestamp = String(Date.now());
    const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(bindings.ACCOUNT_SERVICE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(`${timestamp}.${body}`));
    const response = await fetch(bindings.ACCOUNT_SERVICE_URL!, {
      method: "POST", body, headers: { "Content-Type": "application/json", "X-Account-Timestamp": timestamp, "X-Account-Signature": [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("") },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { status: "unavailable" };
    const decision = await response.json() as AccessDecision;
    if (decision.status === "allowed") return ["free", "basic", "personal", "professional"].includes(decision.plan) ? decision : { status: "unavailable" };
    if (["unauthorized", "unavailable"].includes(decision.status)) return decision;
    if (decision.status === "limited" && Number.isInteger(decision.retryAfter) && decision.retryAfter > 0) return decision;
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Validate the key and atomically spend its owner's shared, database-backed allowance. */
export const authorizeAccountRequest: AuthorizeRequest = async (secret, bindings, sharedSql) => {
  if (!secret || !/^sm_live_[a-f0-9]{48}$/.test(secret)) return { status: "unauthorized" };
  if (bindings.ACCOUNT_SERVICE_URL) return authorizeViaService(secret, bindings);
  const databaseUrl = bindings.DB_CONNECTION_URL;
  if (!databaseUrl) return { status: "unavailable" };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  // Workers sockets belong to their request; do not share a client across requests.
  const sql = sharedSql ?? postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 5 });
  try {
    const lookupKey = () => sql<{ user_id: string; request_limit: number; api_plan: ApiPlan }[]>`
      SELECT k.user_id, entitlement.plan AS api_plan,
        COALESCE(p.request_limit, CASE entitlement.plan WHEN 'basic' THEN 60 WHEN 'personal' THEN 300 WHEN 'professional' THEN 500 ELSE 10 END) AS request_limit
      FROM api_key k JOIN "user" u ON u.id = k.user_id
      CROSS JOIN LATERAL (SELECT CASE WHEN u.plan_expires_at > now() AND u.api_plan IN ('basic', 'personal', 'professional') THEN u.api_plan ELSE 'free' END AS plan) entitlement
      LEFT JOIN usage_policy p ON p.id = CASE WHEN entitlement.plan = 'free' THEN 'default' ELSE entitlement.plan END
      WHERE k.key_hash = ${hash} AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > now()) AND u.profile_completed = true
      LIMIT 1
    `;
    // Retry only the read before spending quota, so retries cannot count twice.
    // Request-scoped clients close after each decision, releasing scarce slots.
    let key: { user_id: string; request_limit: number; api_plan: ApiPlan } | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        [key] = await lookupKey();
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "53300" || attempt >= 30) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
      }
    }
    if (!key) return { status: "unauthorized" };
    const allowance = await sql`
      INSERT INTO account_usage (user_id, window_started_at, request_count)
      VALUES (${key.user_id}, now(), 1)
      ON CONFLICT (user_id) DO UPDATE SET
        request_count = CASE WHEN account_usage.window_started_at <= now() - interval '1 minute'
          THEN 1 ELSE account_usage.request_count + 1 END,
        window_started_at = CASE WHEN account_usage.window_started_at <= now() - interval '1 minute'
          THEN now() ELSE account_usage.window_started_at END
      WHERE account_usage.window_started_at <= now() - interval '1 minute'
        OR account_usage.request_count < ${key.request_limit}
      RETURNING user_id
    `;
    if (allowance.length) return { status: "allowed", plan: key.api_plan };
    const [window] = await sql<{ retry_after: number }[]>`
      SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_started_at + interval '1 minute' - now())))::integer AS retry_after
      FROM account_usage WHERE user_id = ${key.user_id}
    `;
    return { status: "limited", retryAfter: window?.retry_after ?? 1 };
  } catch (error) {
    // Database errors can contain connection credentials; never return or log them.
    const failure = error as { name?: string; code?: string };
    console.error(JSON.stringify({ event: "api.account_storage.unavailable", name: failure.name, code: failure.code }));
    return { status: "unavailable" };
  } finally {
    if (!sharedSql) await sql.end({ timeout: 1 });
  }
};
