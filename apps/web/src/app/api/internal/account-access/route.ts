import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeAccountRequest, serializeTimings } from "@stock-market/db/account-access";
import { log } from "@stock-market/common/logger";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const since = () => Math.round((performance.now() - startedAt) * 10) / 10;
  let dbMs: number | undefined;
  const respond = (result: unknown, status: number, reason?: string) => {
    // dbMs covers the authorization call only, so totalMs - dbMs is this
    // function's own boot, signature check and serialization overhead.
    const timings = { totalMs: since(), dbMs };
    log(status >= 500 || reason ? "warn" : "info", "account.access.served", { status, reason, ...timings });
    return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store", "X-Account-Timing": serializeTimings(timings) } });
  };
  const secret = process.env.ACCOUNT_SERVICE_SECRET ?? (process.env.BETTER_AUTH_SECRET
    ? createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET}:account-access-v1`).digest("hex") : "");
  if (!secret) return respond({ status: "unavailable" }, 503, "no_signing_secret");
  const timestamp = request.headers.get("X-Account-Timestamp") ?? "";
  const signature = request.headers.get("X-Account-Signature") ?? "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 30_000 || !/^[a-f0-9]{64}$/.test(signature)) {
    return respond({ error: "Unauthorized" }, 401, "signature_rejected");
  }
  const body = await request.text();
  if (body.length > 512) return respond({ error: "Invalid request" }, 400, "body_too_large");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return respond({ error: "Unauthorized" }, 401, "signature_mismatch");
  let key: unknown;
  try { key = (JSON.parse(body) as { key?: unknown }).key; } catch { return respond({ error: "Invalid request" }, 400, "body_not_json"); }
  const dbStartedAt = performance.now();
  const result = await authorizeAccountRequest(typeof key === "string" ? key : undefined, { DB_CONNECTION_URL: process.env.DB_CONNECTION_URL });
  dbMs = Math.round((performance.now() - dbStartedAt) * 10) / 10;
  return respond(result, 200);
}
