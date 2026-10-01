import { validateProfileInput, type ProfileDetails } from "./profile";

type ProfileDependencies = {
  baseURL: string;
  getUser: (headers: Headers) => Promise<{ id: string } | null | undefined>;
  saveProfile: (userId: string, profile: ProfileDetails) => Promise<boolean>;
};

export function isSameOriginProfileRequest(request: Request, baseURL: string) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    // The canonical origin also supports deployments behind a reverse proxy.
    return origin === new URL(request.url).origin || origin === new URL(baseURL).origin;
  } catch {
    return false;
  }
}

export function createProfilePostHandler({ baseURL, getUser, saveProfile }: ProfileDependencies) {
  return async function POST(request: Request): Promise<Response> {
    if (!isSameOriginProfileRequest(request, baseURL)) {
      return Response.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const current = await getUser(request.headers);
    if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const input = await request.json().catch(() => null);
    const result = validateProfileInput(input);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

    const saved = await saveProfile(current.id, result.data);
    if (!saved) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json({ ok: true });
  };
}
