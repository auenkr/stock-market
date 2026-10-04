import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { auth, authBaseURL, isGoogleAuthEnabled, isDevAuthEnabled } from "@stock-market/auth";
import { AuthForm } from "@/components/auth-form";

export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : value ? [value] : []) query.append(key, entry);
  }
  const { secret } = await auth.$context;
  if (!(await verifyOAuthQueryParams(query.toString(), secret))) {
    return <main className="auth-page"><section className="auth-card card"><h1>Connect from ChatGPT</h1><p>Start the Ledgerline connection in ChatGPT to open a valid sign-in request.</p></section></main>;
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(`${authBaseURL}/api/auth/oauth2/authorize?${query}`);
  return <AuthForm mode="signup" googleEnabled={isGoogleAuthEnabled} devEnabled={isDevAuthEnabled} oauth />;
}
