import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createApp } from "./server.js";
import { authorizeAccountRequest } from "@stock-market/db/account-access";

const secret = () => `sm_live_${[...crypto.getRandomValues(new Uint8Array(24))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

test("data requests require a valid key and fail closed without account storage", async () => {
  const app = createApp();
  assert.equal((await app.request("/v1/coverage")).status, 401);
  assert.equal((await app.request("/v1/coverage", { headers: { "X-API-Key": "arbitrary" } })).status, 401);
  assert.equal((await app.request("/v1/coverage", { headers: { "X-API-Key": secret() } })).status, 503);
  assert.equal((await app.request("/health")).status, 200);
  assert.equal((await app.request("/openapi.json")).status, 200);
});

test("accounts share an atomic quota across keys and API instances; other accounts, resets and key invalidation work", {
  skip: !process.env.DB_CONNECTION_URL,
}, async () => {
  const url = process.env.DB_CONNECTION_URL!;
  const sql = postgres(url, { max: 4, prepare: false });
  const users = [randomUUID(), randomUUID()];
  const keys = [secret(), secret(), secret(), secret(), secret()];
  try {
    // Fresh CI databases have the schema but no usage-policy rows yet.
    if (process.env.INTEGRATION_DATABASE_URL === url) {
      await sql`INSERT INTO usage_policy (id, request_limit) VALUES ('default', 10) ON CONFLICT (id) DO NOTHING`;
    }
    for (const id of users) await sql`INSERT INTO "user" (id, name, email, profile_completed, created_at, updated_at)
      VALUES (${id}, 'Quota test', ${`${id}@quota-test.invalid`}, true, now(), now())`;
    for (let i = 0; i < keys.length; i++) await sql`
      INSERT INTO api_key (id, user_id, name, key_hash, expires_at, revoked_at)
      VALUES (${randomUUID()}, ${users[i === 2 ? 1 : 0]!}, 'Quota test',
        ${createHash("sha256").update(keys[i]!).digest("hex")},
        ${i === 3 ? new Date(Date.now() - 1000).toISOString() : null},
        ${i === 4 ? new Date().toISOString() : null})
    `;
    await sql`UPDATE "user" SET api_plan = 'personal', plan_expires_at = now() + interval '1 month' WHERE id = ${users[1]!}`;
    const [policy] = await sql`SELECT request_limit FROM usage_policy WHERE id = 'default'`;
    assert.equal(policy!.request_limit, 10);
    const authorize: typeof authorizeAccountRequest = (key, bindings) => authorizeAccountRequest(key, bindings, sql);
    const apps = [createApp(undefined, authorize), createApp(undefined, authorize)];
    const request = (key: string, index = 0) => process.env.ACCOUNT_TEST_API_URL
      ? fetch(new URL("/v1/coverage", process.env.ACCOUNT_TEST_API_URL), { headers: { "X-API-Key": key } })
      : apps[index]!.request("/v1/coverage", { headers: { "X-API-Key": key } }, { DB_CONNECTION_URL: url });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => request(keys[i % 2]!, i % 2)));
    assert.equal(results.filter((response) => response.status === 200).length, 10, `Statuses: ${results.map((response) => response.status).join(", ")}`);
    assert.equal(results.filter((response) => response.status === 429).length, 2, `Statuses: ${results.map((response) => response.status).join(", ")}`);
    for (const response of results.filter((response) => response.status === 429)) {
      assert(Number(response.headers.get("Retry-After")) > 0);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
    const paidResults = await Promise.all(Array.from({ length: 302 }, (_, i) => request(keys[2]!, i % 2)));
    assert.equal(paidResults.filter((response) => response.status === 200).length, 300, `Paid statuses: ${paidResults.map((response) => response.status).join(", ")}`);
    assert.equal(paidResults.filter((response) => response.status === 429).length, 2);
    // Changing the stored plan takes effect without issuing a new key.
    await sql`UPDATE "user" SET api_plan = 'personal', plan_expires_at = now() + interval '1 month' WHERE id = ${users[0]!}`;
    assert.equal((await request(keys[0]!)).status, 200);
    assert.equal((await request(keys[3]!)).status, 401);
    assert.equal((await request(keys[4]!)).status, 401);
    assert.equal((await request(secret())).status, 401);
    await sql`UPDATE account_usage SET window_started_at = now() - interval '61 seconds' WHERE user_id = ${users[0]!}`;
    assert.equal((await request(keys[0]!)).status, 200);
    const [usage] = await sql`SELECT request_count FROM account_usage WHERE user_id = ${users[0]!}`;
    assert.equal(usage!.request_count, 1);
  } finally {
    await sql`DELETE FROM "user" WHERE id IN ${sql(users)}`;
    await sql.end();
  }
});


test("connection exhaustion retries only the key read and never spends quota twice", async () => {
  let reads = 0;
  let writes = 0;
  let failWrite = false;
  const client = async (strings: TemplateStringsArray) => {
    if (strings.join("").includes("FROM api_key")) {
      reads++;
      if (reads <= 2) throw Object.assign(new Error("Connection slots full"), { code: "53300" });
      return [{ user_id: "quota-test", api_plan: "free", request_limit: 10 }];
    }
    writes++;
    if (failWrite) throw Object.assign(new Error("Write failed"), { code: "53300" });
    return [{ user_id: "quota-test" }];
  };
  const sql = client as unknown as NonNullable<Parameters<typeof authorizeAccountRequest>[2]>;
  assert.deepEqual(await authorizeAccountRequest(secret(), { DB_CONNECTION_URL: "test" }, sql), { status: "allowed", plan: "free" });
  assert.equal(reads, 3);
  assert.equal(writes, 1);
  failWrite = true;
  assert.deepEqual(await authorizeAccountRequest(secret(), { DB_CONNECTION_URL: "test" }, sql), { status: "unavailable" });
  assert.equal(reads, 4);
  assert.equal(writes, 2);
});
