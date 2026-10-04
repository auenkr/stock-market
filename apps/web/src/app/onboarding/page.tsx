import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@stock-market/auth";
import { ProfileForm } from "@/components/profile-form";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = next === "/dashboard/billing" || next?.startsWith("/connect/chatgpt/consent?") ? next : "/dashboard";
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  if (session.user.profileCompleted) redirect(destination);

  return <ProfileForm name={session.user.name} email={session.user.email} company={session.user.company ?? ""} destination={destination} />;
}
