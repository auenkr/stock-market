import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isGoogleAuthEnabled } from "@stock-market/auth";
import { AuthForm } from "@/components/auth-form";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const destination = next === "/dashboard/billing" ? next : "/dashboard";
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(session.user.profileCompleted ? destination : "/onboarding");

  const initialError = error ? "Google signup could not be completed. Please try again." : "";
  return <AuthForm mode="signup" googleEnabled={isGoogleAuthEnabled} initialError={initialError} destination={destination} />;
}
