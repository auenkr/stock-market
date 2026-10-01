import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isGoogleAuthEnabled } from "@stock-market/auth";
import { AuthForm } from "@/components/auth-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(session.user.profileCompleted ? "/dashboard" : "/onboarding");

  const { error } = await searchParams;
  const initialError = error === "account_not_linked"
    ? "This email already has an account. Continue with Google using that account."
    : error ? "Google sign-in could not be completed. Please try again." : "";
  return <AuthForm mode="login" googleEnabled={isGoogleAuthEnabled} initialError={initialError} />;
}
