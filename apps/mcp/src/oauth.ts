export const MCP_SCOPE = "market:read";
export interface OAuthEnv {
  MCP_RESOURCE_URL?: string;
  MCP_AUTHORIZATION_SERVER?: string;
  MCP_ACCOUNT_SERVICE_SECRET?: string;
}
export function oauthConfiguration(env: OAuthEnv) {
  const resource = env.MCP_RESOURCE_URL || "https://stock-market-mcp.auenkr.com/mcp";
  const issuer = env.MCP_AUTHORIZATION_SERVER || "https://stock-market.auenkr.com/api/auth";
  return { resource, issuer, metadataUrl: `${new URL(resource).origin}/.well-known/oauth-protected-resource` };
}
export function authorizationRequired(env: OAuthEnv): Response {
  const { metadataUrl } = oauthConfiguration(env);
  return Response.json({ error: "Account connection required" }, { status: 401, headers: {
    "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="${MCP_SCOPE}"`,
    "Cache-Control": "no-store",
  } });
}
export async function resolveOAuthAccess(token: string, env: OAuthEnv) {
  const secret = env.MCP_ACCOUNT_SERVICE_SECRET;
  if (!secret || secret.length < 32) throw new Error("MCP account service is not configured");
  const body = JSON.stringify({ token });
  const timestamp = String(Date.now());
  const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  const { issuer } = oauthConfiguration(env);
  const response = await fetch(`${issuer}/mcp/access`, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(10000), headers: {
    "Content-Type": "application/json", "X-MCP-Timestamp": timestamp, "X-MCP-Signature": signature,
  } });
  if (response.status === 401 || response.status === 403 || response.status === 400) return null;
  if (!response.ok) throw new Error("MCP account service unavailable");
  const result = await response.json() as { apiKey?: string; clientId?: string; scopes?: string[] };
  if (!result.apiKey?.startsWith("sm_live_") || !result.clientId || !result.scopes?.includes(MCP_SCOPE)) throw new Error("Invalid account service response");
  return { apiKey: result.apiKey, clientId: result.clientId, scopes: result.scopes };
}
