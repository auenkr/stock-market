import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, user, account } from "@stock-market/db";
import { eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";

test("admin CLI creates a verified password account and refuses to overwrite existing users", async () => {
  assert.ok(process.env.INTEGRATION_DATABASE_URL, "Run through the disposable integration database");
  const directory = await mkdtemp(join(tmpdir(), "ledgerline-reviewer-test-"));
  const output = join(directory, "access.md");
  const email = "reviewer-fixture@example.test";
  const args = ["packages/auth/scripts/create-password-account.mjs", "--email", email, "--plan", "personal", "--credentials-file", output];
  const env = { ...process.env, DB_CONNECTION_URL: process.env.INTEGRATION_DATABASE_URL };
  try {
    const stdout = execFileSync(process.execPath, args, { env, encoding: "utf8" });
    const document = await readFile(output, "utf8");
    const password = document.match(/^Password: (.+)$/m)?.[1];
    assert.ok(password);
    assert.equal(stdout.includes(password), false);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const [created] = await db.select().from(user).where(eq(user.email, email));
    assert.ok(created);
    assert.equal(created.emailVerified, true);
    assert.equal(created.profileCompleted, true);
    assert.equal(created.apiPlan, "personal");
    assert.ok(created.planExpiresAt! > new Date());
    assert.equal(created.polarCustomerId, null, "Provisioning never purchases a subscription");
    const [credential] = await db.select().from(account).where(eq(account.userId, created.id));
    assert.ok(credential);
    assert.equal(credential.providerId, "credential");
    assert.ok(await verifyPassword({ hash: credential.password!, password }));
    const duplicate = spawnSync(process.execPath, [...args.slice(0, -1), join(directory, "duplicate.md")], { env, encoding: "utf8" });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /Account already exists/);
    const [unchanged] = await db.select().from(account).where(eq(account.userId, created.id));
    assert.ok(unchanged);
    assert.equal(unchanged.password, credential.password);
  } finally {
    await db.delete(user).where(eq(user.email, email));
    await rm(directory, { recursive: true, force: true });
    await db.$client.end();
  }
});
