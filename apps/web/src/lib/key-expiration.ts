export const keyExpirationOptions = [
  { value: "1d", label: "1 day", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "never", label: "Never", days: null },
] as const;

export type KeyExpiration = typeof keyExpirationOptions[number]["value"];

export function parseKeyCreation(body: unknown, now = new Date()) {
  if (!body || typeof body !== "object") throw new Error("Key name and expiration are required.");
  const { name, expiration } = body as { name?: unknown; expiration?: unknown };
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
    throw new Error("A name between 1 and 80 characters is required.");
  }
  const option = keyExpirationOptions.find((item) => item.value === expiration);
  if (!option) throw new Error("Choose a valid key expiration.");
  return {
    name: name.trim(),
    expiresAt: option.days === null ? null : new Date(now.getTime() + option.days * 86_400_000),
  };
}

export function isKeyExpired(expiresAt: string | null, now = Date.now()) {
  return expiresAt !== null && new Date(expiresAt).getTime() <= now;
}
