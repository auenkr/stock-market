import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { account, createId, db, user } from "@stock-market/db";
import { eq } from "drizzle-orm";

// Run only from an administrator's shell with direct database access.
// No HTTP signup route or privileged credentials are exposed to the browser.
const { values } = parseArgs({ options: {
  email: { type: "string" }, name: { type: "string", default: "Ledgerline Reviewer" },
  plan: { type: "string", default: "personal" },
  "expires-at": { type: "string" }, "credentials-file": { type: "string" },
  "password-file": { type: "string" },
  "base-url": { type: "string", default: "https://stock-market.auenkr.com" },
} });

let file;
let created = false;
try {
  if (!process.env.DB_CONNECTION_URL) throw new Error("DB_CONNECTION_URL is required; no default database is allowed.");
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid --email.");
  if (!values.name.trim()) throw new Error("Provide a non-empty --name.");
  if (!["free", "basic", "personal", "professional"].includes(values.plan)) throw new Error("Invalid --plan.");
  const expiresAt = values["expires-at"] ? new Date(values["expires-at"]) : new Date(Date.now() + 365 * 86400000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error("--expires-at must be a future date.");
  if (!values["credentials-file"]) throw new Error("Provide a --credentials-file document path.");
  const baseURL = new URL(values["base-url"]);
  if (baseURL.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseURL.hostname)) throw new Error("Use an HTTPS --base-url.");
  const output = resolve(values["credentials-file"]);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  file = await open(output, "wx", 0o600); // Refuse to overwrite any existing credential document.
  const password = values["password-file"] ? (await readFile(values["password-file"], "utf8")).trim() : randomBytes(32).toString("base64url");
  if (password.length < 16 || password.length > 128) throw new Error("Password must contain 16–128 characters.");
  const passwordHash = await hashPassword(password);
  const userId = createId();
  const loginURL = new URL("/reviewer/signin", baseURL).href;
  await file.writeFile(`# Ledgerline reviewer access — PRIVATE\n\nLogin URL: ${loginURL}\nEmail: ${email}\nPassword: ${password}\nPlan: ${values.plan}\nPlan expires: ${expiresAt.toISOString()}\n\n1. Open the login URL and sign in with the email and password above. No Google login, email code, or MFA is required.\n2. The dashboard opens with an already completed review profile.\n3. In the same browser, connect Ledgerline in ChatGPT and approve the company-data access request.\n4. Run the five positive and three negative cases from the submission.\n\nThis account has no administrator privileges. Ledgerline has no trading tools. Keep these credentials out of the public plugin ZIP; provide them in OpenAI's reviewer form.\n`);
  await db.transaction(async tx => {
    if ((await tx.select({ id: user.id }).from(user).where(eq(user.email, email))).length) throw new Error("Account already exists; refusing to change its password or access.");
    const now = new Date();
    await tx.insert(user).values({ id: userId, email, name: values.name.trim(), emailVerified: true,
      company: "Ledgerline review workspace", profileCompleted: true, apiPlan: values.plan,
      planExpiresAt: values.plan === "free" ? null : expiresAt, createdAt: now, updatedAt: now });
    await tx.insert(account).values({ id: createId(), userId, accountId: userId, providerId: "credential",
      password: passwordHash, createdAt: now, updatedAt: now });
  });
  created = true;
  console.log(`Created ${email} with ${values.plan} access. Private instructions: ${output}`);
} catch (error) {
  // Do not print database errors: they may contain connection credentials.
  console.error(error instanceof Error && !('code' in error) ? error.message : "Account creation failed; check database access and schema.");
  process.exitCode = 1;
} finally {
  await file?.close();
  if (file && !created) await unlink(resolve(values["credentials-file"]));
  await db.$client.end();
}
