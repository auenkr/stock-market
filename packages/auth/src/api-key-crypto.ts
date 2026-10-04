import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET ??
    (process.env.BETTER_AUTH_SECRET ? `${process.env.BETTER_AUTH_SECRET}:api-key-encryption-v1` : undefined);
  if (!secret || secret.length < 32) throw new Error("API_KEY_ENCRYPTION_SECRET must be at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptApiKey(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted || iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted API key");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
