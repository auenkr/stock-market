import { redirect } from "next/navigation";
import { auth } from "@stock-market/auth";
import { headers } from "next/headers";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/dashboard" : "/signin");
}
