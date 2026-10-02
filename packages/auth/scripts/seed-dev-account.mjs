import { hashPassword } from "better-auth/crypto";
import { account, createId, db, user } from "@stock-market/db";
import { and, eq } from "drizzle-orm";

if (process.env.ENVIRONMENT !== "dev") throw new Error("Development accounts require ENVIRONMENT=dev");
const username = process.env.DEV_USERNAME?.trim().toLowerCase() || "dev";
const password = process.env.DEV_PASSWORD;
if (!/^[a-z0-9_-]+$/.test(username)) throw new Error("DEV_USERNAME must contain only letters, numbers, underscores, or hyphens");
if (!password || password.length < 8) throw new Error("DEV_PASSWORD must contain at least 8 characters");
const email = `${username}@auenkr.com`;
try {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(user).where(eq(user.email, email));
    const now = new Date();
    const userId = existing?.id ?? createId();
    if (!existing) await tx.insert(user).values({
      id: userId, email, name: "Development Tester", emailVerified: true,
      company: "Ledgerline development", profileCompleted: true, createdAt: now, updatedAt: now,
    });
    const [credentials] = await tx.select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
    if (credentials) await tx.update(account).set({ password: passwordHash, updatedAt: now }).where(eq(account.id, credentials.id));
    else await tx.insert(account).values({
      id: createId(), userId, accountId: userId, providerId: "credential",
      password: passwordHash, createdAt: now, updatedAt: now,
    });
  });
  console.log(`Development account ready: ${username}`);
} finally {
  await db.$client.end();
}
