import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeAccountRequest } from "@stock-market/db/account-access";

export async function POST(request: Request) {
  const secret = process.env.ACCOUNT_SERVICE_SECRET ?? (process.env.BETTER_AUTH_SECRET
    ? createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET}:account-access-v1`).digest("hex") : "");
  if (!secret) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  const timestamp = request.headers.get("X-Account-Timestamp") ?? "";
  const signature = request.headers.get("X-Account-Signature") ?? "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 30_000 || !/^[a-f0-9]{64}$/.test(signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.text();
  if (body.length > 512) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let key: unknown;
  try { key = (JSON.parse(body) as { key?: unknown }).key; } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const result = await authorizeAccountRequest(typeof key === "string" ? key : undefined, { DB_CONNECTION_URL: process.env.DB_CONNECTION_URL });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
