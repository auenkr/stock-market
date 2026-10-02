import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isDevAuthEnabled, isGoogleAuthEnabled } from "@stock-market/auth";
import { AuthForm } from "@/components/auth-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const destination = next === "/dashboard/billing" ? next : "/dashboard";
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(session.user.profileCompleted ? destination : "/onboarding");

  const initialError = error === "account_not_linked"
    ? "This email already has an account. Continue with Google using that account."
    : error ? "Google sign-in could not be completed. Please try again." : "";
  return <AuthForm mode="login" googleEnabled={isGoogleAuthEnabled} devEnabled={isDevAuthEnabled} initialError={initialError} destination={destination} />;
}
