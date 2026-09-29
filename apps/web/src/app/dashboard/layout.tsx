import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@stock-market/auth";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  return <div className="shell"><Sidebar /><main className="main"><header className="topbar"><span className="eyebrow">Workspace / {session.user.name}</span><span className="user-chip">{session.user.email}</span></header>{children}</main></div>;
}
