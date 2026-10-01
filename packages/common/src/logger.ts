export function errorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return { name: "UnknownError" };
  const failure = error as { name?: string; message?: string; code?: string; response?: { status?: number }; cause?: unknown };
  return {
    name: failure.name,
    message: failure.message?.replace(/https?:\/\/[^\s]+/g, (url) => {
      try { const parsed = new URL(url); return parsed.origin + parsed.pathname; }
      catch { return "[url]"; }
    }),
    code: failure.code,
    upstreamStatus: failure.response?.status,
    ...(failure.cause ? { cause: errorDetails(failure.cause) } : {}),
  };
}

// Never serialize request headers, Axios configs, response bodies or credentials.
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
}
