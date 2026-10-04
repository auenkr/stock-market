import postgres from "postgres";
import { errorDetails, log } from "@stock-market/common/logger";
import type { ApiPlan } from "./plans.js";
export type { ApiPlan } from "./plans.js";

export type AccessDecision = { status: "allowed"; plan: ApiPlan } | { status: "unauthorized" } | { status: "unavailable" } | { status: "limited"; retryAfter: number };
export type AccountAccessBindings = { DB_CONNECTION_URL?: string; ACCOUNT_SERVICE_URL?: string; ACCOUNT_SERVICE_SECRET?: string };
export type AuthorizeRequest = (secret: string | undefined, bindings: AccountAccessBindings, sharedSql?: postgres.Sql) => Promise<AccessDecision>;

/** Where the wall-clock time of one authorization decision went. Serialized to logs and to `X-Account-Timing`. */
export type AccountAccessTimings = {
  totalMs: number;
  /** The caller's own authorization call, when it measured one. */
  dbMs?: number;
  connectMs?: number; lookupMs?: number; spendMs?: number; retryAfterMs?: number; closeMs?: number;
  queries?: number; pooledConnection?: boolean;
};

const since = (startedAt: number) => Math.round((performance.now() - startedAt) * 10) / 10;
const TIMING_HEADER = "X-Account-Timing";

export function serializeTimings(timings: AccountAccessTimings) {
  return JSON.stringify(timings, (_name, value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value));
}

export function parseTimings(header: string | null | undefined): AccountAccessTimings | undefined {
  if (!header) return undefined;
  try {
    const parsed = JSON.parse(header) as AccountAccessTimings;
    return typeof parsed?.totalMs === "number" ? parsed : undefined;
  } catch { return undefined; }
}

async function authorizeViaService(secret: string, bindings: AccountAccessBindings): Promise<AccessDecision> {
  if (!bindings.ACCOUNT_SERVICE_SECRET) return { status: "unavailable" };
  const serviceStartedAt = performance.now();
  try {
    const body = JSON.stringify({ key: secret });
    const timestamp = String(Date.now());
    const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(bindings.ACCOUNT_SERVICE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(`${timestamp}.${body}`));
    const response = await fetch(bindings.ACCOUNT_SERVICE_URL!, {
      method: "POST", body, headers: { "Content-Type": "application/json", "X-Account-Timestamp": timestamp, "X-Account-Signature": [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("") },
      signal: AbortSignal.timeout(30_000),
    });
    const roundTripMs = since(serviceStartedAt);
    const remote = parseTimings(response.headers.get(TIMING_HEADER));
    // The signed service reports where its own time went; surface it so a single
    // log line explains the whole authorization chain.
    log("info", "account.service.completed", {
      status: response.status, roundTripMs, endpoint: new URL(bindings.ACCOUNT_SERVICE_URL!).origin + new URL(bindings.ACCOUNT_SERVICE_URL!).pathname,
      dbMs: remote?.dbMs,
      // Round trip minus the service's own work is network and function boot.
      transportMs: remote ? Math.round((roundTripMs - remote.totalMs) * 10) / 10 : undefined,
      ...remote,
    });
    if (!response.ok) return { status: "unavailable" };
    const decision = await response.json() as AccessDecision;
    if (decision.status === "allowed") return ["free", "basic", "personal", "professional"].includes(decision.plan) ? decision : { status: "unavailable" };
    if (["unauthorized", "unavailable"].includes(decision.status)) return decision;
    if (decision.status === "limited" && Number.isInteger(decision.retryAfter) && decision.retryAfter > 0) return decision;
    return { status: "unavailable" };
  } catch (error) {
    log("error", "account.service.failed", { durationMs: since(serviceStartedAt), error: errorDetails(error) });
    return { status: "unavailable" };
  }
}

/** Validate the key and atomically spend its owner's shared, database-backed allowance. */
export const authorizeAccountRequest: AuthorizeRequest = async (secret, bindings, sharedSql) => {
  const totalStartedAt = performance.now();
  if (!secret || !/^sm_live_[a-f0-9]{48}$/.test(secret)) return { status: "unauthorized" };
  if (bindings.ACCOUNT_SERVICE_URL) return authorizeViaService(secret, bindings);
  const databaseUrl = bindings.DB_CONNECTION_URL;
  if (!databaseUrl) return { status: "unavailable" };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  // Workers sockets belong to their request; do not share a client across requests.
  const pooled = Boolean(sharedSql);
  const sql = sharedSql ?? postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 5 });
  const timings: AccountAccessTimings = { totalMs: 0, queries: 0, pooledConnection: pooled };
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
  const spend = (userId: string, requestLimit: number) => sql`
      INSERT INTO account_usage (user_id, window_started_at, request_count)
      VALUES (${userId}, now(), 1)
      ON CONFLICT (user_id) DO UPDATE SET
        request_count = CASE WHEN account_usage.window_started_at <= now() - interval '1 minute'
          THEN 1 ELSE account_usage.request_count + 1 END,
        window_started_at = CASE WHEN account_usage.window_started_at <= now() - interval '1 minute'
          THEN now() ELSE account_usage.window_started_at END
      WHERE account_usage.window_started_at <= now() - interval '1 minute'
        OR account_usage.request_count < ${requestLimit}
      RETURNING user_id
    `;
  const retryAfter = (userId: string) => sql<{ retry_after: number }[]>`
      SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_started_at + interval '1 minute' - now())))::integer AS retry_after
      FROM account_usage WHERE user_id = ${userId}
    `;
  /** Adds one statement's duration and keeps the query counter honest. */
  const measure = async <T,>(field: "lookupMs" | "spendMs" | "retryAfterMs", run: () => Promise<T>) => {
    const startedAt = performance.now();
    const result = await run();
    timings[field] = Math.round(((timings[field] ?? 0) + since(startedAt)) * 10) / 10;
    timings.queries = (timings.queries ?? 0) + 1;
    return result;
  };
  let decision: AccessDecision;
  // Retry only the read before spending quota, so retries cannot count twice.
  // Request-scoped clients close after each decision, releasing scarce slots.
  try {
    let key: { user_id: string; request_limit: number; api_plan: ApiPlan } | undefined;
    for (let attempt = 0; ; attempt++) {
      try { [key] = await measure("lookupMs", lookupKey); break; }
      catch (error) {
        if ((error as { code?: string }).code !== "53300" || attempt >= 30) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
      }
    }
    // The first statement is what forces the TCP/TLS/auth handshake, so its time
    // carries the connection cost whenever the client is not shared.
    if (!pooled) timings.connectMs = timings.lookupMs;
    if (!key) decision = { status: "unauthorized" };
    else {
      const allowance = await measure("spendMs", () => spend(key!.user_id, key!.request_limit));
      if (allowance.length) decision = { status: "allowed", plan: key.api_plan };
      else {
        const [window] = await measure("retryAfterMs", () => retryAfter(key!.user_id));
        decision = { status: "limited", retryAfter: window?.retry_after ?? 1 };
      }
    }
  } catch (error) {
    // Database errors can contain connection credentials; never return or log them.
    const failure = error as { name?: string; code?: string };
    log("error", "account.storage.unavailable", { name: failure.name, code: failure.code, ...timings, totalMs: since(totalStartedAt) });
    return { status: "unavailable" };
  } finally {
    if (!sharedSql) {
      const closeStartedAt = performance.now();
      await sql.end({ timeout: 1 });
      timings.closeMs = since(closeStartedAt);
    }
  }
  timings.totalMs = since(totalStartedAt);
  log(decision.status === "allowed" ? "info" : "warn", "account.storage.completed", {
    status: decision.status, plan: decision.status === "allowed" ? decision.plan : undefined, ...timings,
  });
  return decision;
};
