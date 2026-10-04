import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { auth } from "@stock-market/auth";
import { McpConsent } from "@/components/mcp-consent";

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value ? [value] : []) query.append(key, entry);
  }
  const { secret } = await auth.$context;
  const valid = await verifyOAuthQueryParams(query.toString(), secret);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!valid || !session) return <main className="auth-page"><section className="auth-card card"><h1>Connection expired</h1><p>Start the Ledgerline connection again from ChatGPT.</p></section></main>;
  if (!session.user.profileCompleted) redirect(`/onboarding?next=${encodeURIComponent(`/connect/chatgpt/consent?${query}`)}`);
  const scopes = (query.get("scope") || "").split(/\s+/).filter(Boolean);
  if (scopes.some(scope => !["openid", "email", "offline_access", "market:read"].includes(scope)) || query.has("claims")) {
    return <main className="auth-page"><section className="auth-card card"><h1>Unsupported access request</h1><p>This connection requested access beyond Ledgerline's company-data tools.</p></section></main>;
  }
  const client = await auth.api.getOAuthClientPublic({ headers: await headers(), query: { client_id: query.get("client_id") || "" } });
  return <main className="auth-page"><McpConsent clientName={client.client_name || "application"} scopes={scopes} /></main>;
}
