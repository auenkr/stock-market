"use client";

import { usePathname } from "next/navigation";
import { PageMotion } from "@stock-market/ui/motion";

export function DashboardMotion() {
  const pathname = usePathname();
  return <PageMotion key={pathname} rootId="dashboard-content" />;
}
