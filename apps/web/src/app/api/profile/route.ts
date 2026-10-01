import { eq } from "drizzle-orm";
import { auth, authBaseURL } from "@stock-market/auth";
import { db, user } from "@stock-market/db";
import { createProfilePostHandler } from "@/lib/profile-api";

export const POST = createProfilePostHandler({
  baseURL: authBaseURL,
  async getUser(headers) {
    const session = await auth.api.getSession({ headers });
    return session?.user;
  },
  async saveProfile(userId, profile) {
    const updated = await db.update(user).set({
      ...profile,
      profileCompleted: true,
      updatedAt: new Date(),
    }).where(eq(user.id, userId)).returning({ id: user.id });
    return updated.length > 0;
  },
});
