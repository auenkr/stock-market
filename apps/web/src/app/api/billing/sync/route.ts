import { auth, authBaseURL, isBillingEnabled, syncAccountBilling } from "@stock-market/auth";
import { isSameOriginProfileRequest } from "@/lib/profile-api";

export async function POST(request: Request) {
  if (!isSameOriginProfileRequest(request, authBaseURL)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.profileCompleted || !session.user.termsAcceptedAt) return Response.json({ error: "Complete signup first" }, { status: 403 });
  if (!isBillingEnabled) return Response.json({ error: "Billing is not available yet" }, { status: 503 });
  try {
    await syncAccountBilling(session.user);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Could not refresh subscription status" }, { status: 502 }); }
}
