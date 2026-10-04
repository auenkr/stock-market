import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createAuthEndpoint, APIError } from "better-auth/api";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, user, apiKey, oauthConsent, createId } from "@stock-market/db";
import { mcpOAuthOptions, mcpResource, mcpScope } from "./mcp-config.js";
import { encryptApiKey } from "./api-key-crypto.js";

// Private server-to-server adapter. The OAuth token never becomes a REST key.
export function mcpAccountAccess() {
  return {
    id: "mcp-account-access",
    endpoints: {
      mcpAccess: createAuthEndpoint("/mcp/access", {
        method: "POST",
        body: z.object({ token: z.string().min(1).max(16384) }).strict(),
      }, async ctx => {
        const secret = process.env.MCP_ACCOUNT_SERVICE_SECRET;
        if (!secret || secret.length < 32) throw new APIError("SERVICE_UNAVAILABLE");
        const timestamp = ctx.headers?.get("X-MCP-Timestamp") || "";
        const signature = ctx.headers?.get("X-MCP-Signature") || "";
        const deny = () => new APIError("UNAUTHORIZED", { message: "MCP authorization required" });
        if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 30000 || !/^[a-f0-9]{64}$/.test(signature)) throw deny();
        const expected = createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(ctx.body)}`).digest();
        if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw deny();
        let payload;
        try { payload = await getOAuthProviderApi(ctx, mcpOAuthOptions).requireActiveAccessToken(ctx.body.token); }
        catch { throw deny(); }
        const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!audiences.includes(mcpResource) || typeof payload.scope !== "string" || !payload.scope.split(" ").includes(mcpScope) || payload.cnf || typeof payload.sub !== "string" || typeof payload.client_id !== "string") throw deny();
        const [owner] = await db.select().from(user).where(eq(user.id, payload.sub));
        if (!owner?.profileCompleted) throw deny();
        const consents = await db.select().from(oauthConsent).where(and(eq(oauthConsent.userId, owner.id), eq(oauthConsent.clientId, payload.client_id)));
        const consent = consents.find(row => row.scopes.includes(mcpScope) && row.resources?.includes(mcpResource));
        if (!consent) throw deny();
        // Consent-specific key is stable across refreshes. Revoked keys stay revoked.
        const key = `sm_live_${createHmac("sha256", secret).update(`mcp-key-v1:${owner.id}:${consent.id}`).digest("hex").slice(0, 48)}`;
        const keyHash = createHash("sha256").update(key).digest("hex");
        await db.insert(apiKey).values({ id: createId(), userId: owner.id, name: "ChatGPT / MCP connection", keyHash, encryptedSecret: encryptApiKey(key) }).onConflictDoNothing({ target: apiKey.keyHash });
        const [record] = await db.select().from(apiKey).where(eq(apiKey.keyHash, keyHash));
        if (!record || record.userId !== owner.id || record.revokedAt || (record.expiresAt && record.expiresAt <= new Date())) throw deny();
        ctx.setHeader("Cache-Control", "no-store");
        return ctx.json({ apiKey: key, clientId: payload.client_id, scopes: [mcpScope] });
      }),
    },
  };
}
