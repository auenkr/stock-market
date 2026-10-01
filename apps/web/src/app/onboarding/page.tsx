import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@stock-market/auth";
import { ProfileForm } from "@/components/profile-form";

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  if (session.user.profileCompleted) redirect("/dashboard");

  return <ProfileForm name={session.user.name} email={session.user.email} company={session.user.company ?? ""} />;
}
