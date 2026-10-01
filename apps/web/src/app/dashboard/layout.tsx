import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@stock-market/auth";
import { Sidebar } from "@/components/sidebar";
import { ThemePicker } from "@/components/theme-picker";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  if (!session.user.profileCompleted) redirect("/onboarding");
  return <div className="shell"><Sidebar /><main className="main"><header className="topbar"><span className="eyebrow">Workspace / {session.user.name}</span><div className="workspace-actions"><ThemePicker /><span className="user-chip">{session.user.email}</span></div></header>{children}</main></div>;
}
