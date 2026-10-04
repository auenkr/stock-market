import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@stock-market/auth";
import { ReviewerSignInForm } from "@/components/reviewer-signin-form";

export const metadata: Metadata = {
  title: "Reviewer sign in | Ledgerline",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ReviewerSignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(session.user.profileCompleted ? "/dashboard" : "/onboarding");
  return <ReviewerSignInForm />;
}
