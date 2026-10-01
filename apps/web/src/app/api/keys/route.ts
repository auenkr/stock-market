import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@stock-market/auth";
import { apiKey, createId, db } from "@stock-market/db";
import { decryptApiKey, encryptApiKey } from "@/lib/api-key-crypto";
import { getUsagePolicy } from "@/lib/usage-policy";

async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}

export async function GET() {
  const current = await currentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!current.profileCompleted) return NextResponse.json({ error: "Complete your profile before managing API keys" }, { status: 403 });

  const keys = await db.select({
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    encryptedSecret: apiKey.encryptedSecret,
    lastUsedAt: apiKey.lastUsedAt,
    expiresAt: apiKey.expiresAt,
    createdAt: apiKey.createdAt,
    revokedAt: apiKey.revokedAt,
    requestLimit: apiKey.requestLimit,
  }).from(apiKey).where(eq(apiKey.userId, current.id));
  const visibleKeys = keys.map(({ encryptedSecret, ...key }) => ({
    ...key,
    secret: encryptedSecret ? decryptApiKey(encryptedSecret) : null,
  }));
  return NextResponse.json({ keys: visibleKeys, policy: await getUsagePolicy() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await currentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!current.profileCompleted) return NextResponse.json({ error: "Complete your profile before managing API keys" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "A name between 1 and 80 characters is required" }, { status: 400 });
  }

  const secret = `sm_live_${randomBytes(24).toString("hex")}`;
  const prefix = secret.slice(0, 16);
  const policy = await getUsagePolicy();
  await db.insert(apiKey).values({
    id: createId(), userId: current.id, name, prefix,
    keyHash: createHash("sha256").update(secret).digest("hex"),
    encryptedSecret: encryptApiKey(secret),
    requestLimit: policy.requestLimit,
    createdAt: new Date(),
  });
  return NextResponse.json({ key: secret, prefix, name }, { status: 201 });
}

export async function DELETE(request: Request) {
  const current = await currentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!current.profileCompleted) return NextResponse.json({ error: "Complete your profile before managing API keys" }, { status: 403 });
  const { id } = await request.json() as { id?: string };
  if (!id) return NextResponse.json({ error: "Key id is required" }, { status: 400 });
  await db.update(apiKey).set({ revokedAt: new Date() }).where(and(eq(apiKey.id, id), eq(apiKey.userId, current.id), isNull(apiKey.revokedAt)));
  return NextResponse.json({ ok: true });
}
