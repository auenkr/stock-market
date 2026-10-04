import { oauthProvider } from "@better-auth/oauth-provider";

export const mcpResource = process.env.MCP_RESOURCE_URL || "https://stock-market-mcp.auenkr.com/mcp";
export const mcpScope = "market:read";

export const mcpOAuthOptions = {
  loginPage: "/connect/chatgpt",
  consentPage: "/connect/chatgpt/consent",
  scopes: ["openid", "email", "offline_access", mcpScope],
  grantTypes: ["authorization_code", "refresh_token"],
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  // Resource policy is seeded by the migration, not during auth initialization.
  // This keeps Next.js builds and ordinary sign-in independent of database writes.
  // Public clients may request the registered read-only resource with user consent.
  enforcePerClientResources: false,
  accessTokenExpiresIn: 300,
  // Administrative client mutations and machine credentials are never public.
  clientPrivileges: async () => false,
} satisfies NonNullable<Parameters<typeof oauthProvider>[0]>;

export function createMcpOAuthPlugin() {
  return oauthProvider(mcpOAuthOptions);
}
