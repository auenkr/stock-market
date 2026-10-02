import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { hashPassword } from "better-auth/crypto";
import { createPolarCore } from "@polar-sh/sdk/2026-10";
import { db } from "@stock-market/db";
import { authorizeAccountRequest } from "@stock-market/db/account-access";
import { createAuthOptions } from "../src/config.js";
import { createBillingPlugin, createCheckoutHook, syncBillingAccount } from "../src/polar.js";
import { resolveEntitlement } from "../src/billing.js";
import { createConsentHandler, consentCookieName, signConsent, verifyConsent, legalVersion } from "../src/consent.js";
import { listen, close } from "../../../apps/api/tests/harness.js";
import { billingTestEnvironment, customerState, productIds, signedEvent, webhookSecret } from "./billing-fixtures.js";

const baseURL = "http://localhost:3001";
const options = createAuthOptions({ ENVIRONMENT: "dev", BETTER_AUTH_SECRET: "billing-test-auth-secret-at-least-32-characters" });
const userId = randomUUID();
const apiKey = `sm_live_${randomBytes(24).toString("hex")}`;
let auth: { handler: (request: Request) => Promise<Response> };
let cookie: string;
let state = customerState(userId, "free");
let remote: Awaited<ReturnType<typeof listen>>;
const checkoutRequests: Record<string, unknown>[] = [];
const customerRequests: Record<string, unknown>[] = [];
let missingCustomer = false;

before(async () => {
  assert.match(process.env.INTEGRATION_DATABASE_URL || "", /stock_test_/);
  await db.$client`INSERT INTO "user" (id, name, email, profile_completed, created_at, updated_at) VALUES (${userId}, 'Billing tester', ${`${userId}@tests.invalid`}, true, now(), now())`;
  await db.$client`INSERT INTO api_key (id, user_id, name, key_hash) VALUES (${randomUUID()}, ${userId}, 'Billing integration', ${createHash("sha256").update(apiKey).digest("hex")})`;
  await db.$client`INSERT INTO usage_policy (id, request_limit) VALUES ('default', 10), ('personal', 300), ('professional', 500) ON CONFLICT (id) DO UPDATE SET request_limit = EXCLUDED.request_limit`;
  remote = await listen(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-polar-token");
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && req.url?.includes("/customers")) {
      customerRequests.push(JSON.parse(Buffer.concat(chunks).toString()));
      missingCustomer = false;
      res.end(JSON.stringify(state));
    } else if (missingCustomer && req.url?.includes("/customers")) {
      res.writeHead(404); res.end(JSON.stringify({ error: "ResourceNotFound", detail: "Missing customer" }));
    } else if (req.url?.includes("/checkouts")) {
      checkoutRequests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.end(JSON.stringify({ url: "https://sandbox.polar.sh/checkout/test" }));
    } else if (req.url?.includes("/customer-sessions")) {
      res.end(JSON.stringify({ customer_portal_url: "https://sandbox.polar.sh/portal/test" }));
    } else res.end(JSON.stringify(state));
  });
  const transport = createPolarCore({ accessToken: "test-polar-token", baseUrl: remote.url });
  const now = new Date();
  auth = betterAuth({ ...options,
    database: memoryAdapter({
      user: [{ id: userId, name: "Billing tester", email: "dev@ledgerline.test", emailVerified: true, profileCompleted: true, termsAcceptedAt: now, termsVersion: legalVersion, privacyVersion: legalVersion, createdAt: now, updatedAt: now }],
      account: [{ id: randomUUID(), userId, accountId: userId, providerId: "credential", password: await hashPassword("billing-test-password"), createdAt: now, updatedAt: now }], session: [], verification: [],
    }),
    plugins: [createBillingPlugin(billingTestEnvironment, db.$client, baseURL, transport)!],
    hooks: { before: createCheckoutHook((user) => syncBillingAccount(billingTestEnvironment, db.$client, user, transport)) },
    rateLimit: { enabled: false }, logger: { disabled: true },
  });
  const login = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json" }, body: JSON.stringify({ email: "dev@ledgerline.test", password: "billing-test-password" }) }));
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
});
after(async () => { if (remote) await close(remote.server); await db.$client`DELETE FROM "user" WHERE id = ${userId}`; await db.$client.end(); });
const post = (path: string, body: unknown, signedIn = true) => auth.handler(new Request(`${baseURL}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: baseURL, ...(signedIn ? { cookie } : {}) }, body: JSON.stringify(body) }));
const webhook = (data: unknown, timestamp?: string) => { const event = signedEvent(data, timestamp); return auth.handler(new Request(`${baseURL}/api/auth/polar/webhooks`, { method: "POST", ...event })); };
const authorize = () => authorizeAccountRequest(apiKey, { DB_CONNECTION_URL: process.env.INTEGRATION_DATABASE_URL }, db.$client);

test("authenticated checkout maps only monthly plan slugs, binds the owner, and uses the portal for an existing subscription", async () => {
  const unrelated = await auth.handler(new Request(`${baseURL}/api/auth/customer/subscriptions/list?reference_id=another-account`, { headers: { cookie } }));
  assert.equal(unrelated.status, 400);
  assert.equal((await post("/checkout", { slug: "personal" }, false)).status, 401);
  for (const body of [{ slug: "unknown" }, { products: [productIds.professional] }, { slug: "personal", success_url: "https://evil.invalid" }, { slug: "personal", reference_id: "another-user" }, { slug: "personal", allow_trial: true }]) {
    assert.equal((await post("/checkout", body)).status, 400);
  }
  for (const plan of ["personal", "professional"] as const) {
    const response = await post("/checkout", { slug: plan, redirect: false });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json() as { url: string }).url, "https://sandbox.polar.sh/checkout/test");
    const body = checkoutRequests.at(-1)!;
    assert.deepEqual(body.products, [productIds[plan]]);
    assert.equal(body.external_customer_id, userId);
    assert.equal(body.allow_trial, false);
    assert.equal(body.success_url, `${baseURL}/dashboard/billing?checkout=success`);
    assert.deepEqual(await authorize(), { status: "allowed", plan: "free" }, "Creating checkout must not grant access");
  }
  state = customerState(userId, "personal");
  assert.equal((await post("/checkout", { slug: "professional" })).status, 409);
  const portal = await post("/customer/portal", { redirect: false });
  assert.equal(portal.status, 200, await portal.clone().text());
  assert.equal((await portal.json() as { url: string }).url, "https://sandbox.polar.sh/portal/test");
});

test("real Polar signature verification rejects unsigned, tampered, stale, and malformed events without altering access", async () => {
  const event = signedEvent(customerState(userId, "professional"));
  const target = `${baseURL}/api/auth/polar/webhooks`;
  for (const headers of [{ "content-type": "application/json" }, { ...event.headers, "webhook-signature": "v1,forged" }, { ...event.headers, "webhook-timestamp": "1" }]) {
    assert.equal((await auth.handler(new Request(target, { method: "POST", body: event.body, headers }))).status, 403);
  }
  const malformed = signedEvent({});
  malformed.body = "{not-json";
  malformed.headers["webhook-signature"] = `v1,${createHmac("sha256", webhookSecret).update(`${malformed.headers["webhook-id"]}.${malformed.headers["webhook-timestamp"]}.${malformed.body}`).digest("base64")}`;
  assert.equal((await auth.handler(new Request(target, { method: "POST", ...malformed }))).status, 400);
  assert.deepEqual(await authorize(), { status: "allowed", plan: "personal" });
});

test("legacy development accounts use the configured sandbox billing email and retain their authenticated user ID", async () => {
  missingCustomer = true;
  const transport = createPolarCore({ accessToken: "test-polar-token", baseUrl: remote.url });
  await assert.rejects(syncBillingAccount({ ...billingTestEnvironment, ENVIRONMENT: "dev" }, db.$client,
    { id: userId, email: "dev@ledgerline.test", name: "Development Tester" }, transport), /DEV_BILLING_EMAIL/);
  await syncBillingAccount({ ...billingTestEnvironment, ENVIRONMENT: "dev", DEV_BILLING_EMAIL: "billing@example.org" }, db.$client,
    { id: userId, email: "dev@ledgerline.test", name: "Development Tester" }, transport);
  const created = customerRequests.at(-1)!;
  assert.equal(created.email, "billing@example.org");
  assert.equal(created.external_id, userId);
  assert.deepEqual(created.metadata, { ledgerline_development_account: true });
  missingCustomer = true;
  await syncBillingAccount({ ...billingTestEnvironment, ENVIRONMENT: "production" }, db.$client,
    { id: userId, email: "account@example.org", name: "Customer" }, transport);
  assert.equal(customerRequests.at(-1)!.email, "account@example.org");
  assert.equal(customerRequests.at(-1)!.metadata, undefined);
});

test("verified webhook lifecycle upgrades, renews, cancels at period end, revokes, and ignores delayed/duplicate events", async () => {
  const timestamp = new Date(Date.now() + 1000).toISOString();
  const personal = customerState(userId, "personal");
  assert.equal((await webhook(personal, timestamp)).status, 200);
  assert.deepEqual(await authorize(), { status: "allowed", plan: "personal" });
  const professional = customerState(userId, "professional");
  const later = new Date(Date.now() + 2000).toISOString();
  assert.equal((await webhook(professional, later)).status, 200);
  assert.equal((await webhook(professional, later)).status, 200);
  assert.equal((await webhook(customerState(userId, "free"), timestamp)).status, 200);
  assert.deepEqual(await authorize(), { status: "allowed", plan: "professional" });
  const renewed = customerState(userId, "professional", { expires: new Date(Date.now() + 60 * 86400_000).toISOString() });
  assert.equal((await webhook(renewed, new Date(Date.now() + 2500).toISOString())).status, 200);
  const [stored] = await db.$client`SELECT plan_expires_at FROM "user" WHERE id = ${userId}`;
  assert.equal(new Date(stored!.plan_expires_at).toISOString(), renewed.active_subscriptions[0]!.current_period_end);
  assert.equal((await webhook(customerState(userId, "professional", { cancelAtPeriodEnd: true }), new Date(Date.now() + 3000).toISOString())).status, 200);
  assert.deepEqual(await authorize(), { status: "allowed", plan: "professional" });
  assert.equal((await webhook(customerState(userId, "personal", { status: "past_due" }), new Date(Date.now() + 4000).toISOString())).status, 200);
  assert.deepEqual(await authorize(), { status: "allowed", plan: "free" });
  assert.equal((await webhook(professional, new Date(Date.now() + 5000).toISOString())).status, 200);
  assert.equal((await webhook(customerState(userId, "free"), new Date(Date.now() + 6000).toISOString())).status, 200);
  assert.deepEqual(await authorize(), { status: "allowed", plan: "free" });
});

test("10/300/500 account quotas apply across two keys; expiry downgrades without another webhook", async () => {
  const secondKey = `sm_live_${randomBytes(24).toString("hex")}`;
  await db.$client`INSERT INTO api_key (id, user_id, name, key_hash) VALUES (${randomUUID()}, ${userId}, 'Second key', ${createHash("sha256").update(secondKey).digest("hex")})`;
  for (const [plan, limit] of [["free", 10], ["personal", 300], ["professional", 500]] as const) {
    await db.$client`DELETE FROM account_usage WHERE user_id = ${userId}`;
    await db.$client`UPDATE "user" SET api_plan = ${plan}, plan_expires_at = now() + interval '1 month' WHERE id = ${userId}`;
    const decisions = await Promise.all(Array.from({ length: limit + 2 }, (_, i) => authorizeAccountRequest(i % 2 ? apiKey : secondKey, { DB_CONNECTION_URL: process.env.INTEGRATION_DATABASE_URL }, db.$client)));
    assert.equal(decisions.filter((d) => d.status === "allowed").length, limit);
    assert.equal(decisions.filter((d) => d.status === "limited").length, 2);
  }
  await db.$client`DELETE FROM account_usage WHERE user_id = ${userId}`;
  const future = new Date(Date.now() + 3600_000).toISOString();
  await db.$client`UPDATE "user" SET plan_expires_at = ${future} WHERE id = ${userId}`;
  assert.deepEqual(await authorize(), { status: "allowed", plan: "professional" }, "UTC Polar deadlines must remain valid in a non-UTC database timezone");
  await db.$client`UPDATE "user" SET plan_expires_at = now() - interval '1 second' WHERE id = ${userId}`;
  assert.deepEqual(await authorize(), { status: "allowed", plan: "free" });
  const unknownProduct = customerState(userId, "personal"); unknownProduct.active_subscriptions[0]!.product_id = randomUUID();
  assert.equal(resolveEntitlement(unknownProduct, productIds).plan, "free");
  for (const status of ["past_due", "paused", "unpaid", "trialing", "canceled"]) assert.equal(resolveEntitlement(customerState(userId, "personal", { status }), productIds).plan, "free");
  assert.equal(resolveEntitlement(customerState(userId, "professional", { interval: "year" }), productIds).plan, "free");
});

test("signup consent is explicit, signed, expiring, and required by the actual OAuth user-creation hook", async () => {
  const handler = createConsentHandler(options.secret!, baseURL);
  const request = (accepted: unknown, origin = baseURL) => new Request(`${baseURL}/api/legal/consent`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ accepted }) });
  assert.equal((await handler(request(false))).status, 400);
  assert.equal((await handler(request("true"))).status, 400);
  assert.equal((await handler(request(true, "https://evil.invalid"))).status, 403);
  const response = await handler(request(true));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
  assert(verifyConsent(response.headers.get("set-cookie"), options.secret!));
  assert(!verifyConsent(`${consentCookieName}=${signConsent(options.secret!, Date.now() - 31 * 60_000)}`, options.secret!));
  assert(!verifyConsent(`${consentCookieName}=${signConsent("forged-secret")}`, options.secret!));
  await assert.rejects(options.databaseHooks.user.create.before({}, { headers: new Headers() }), /Agree to/);
  const accepted = await options.databaseHooks.user.create.before({ name: "Ada" }, { headers: new Headers({ cookie: response.headers.get("set-cookie")! }) });
  assert.equal(accepted.data.termsVersion, legalVersion);
  assert.equal(accepted.data.privacyVersion, legalVersion);
});

test("billing migration upgrades legacy plans, preserves Basic limits, and is repeatable", async () => {
  const migration = await readFile(new URL("../../db/migrations/0010_billing_and_consent.sql", import.meta.url), "utf8");
  await db.$client.begin(async (tx) => {
    await tx`CREATE SCHEMA billing_migration_test`;
    try {
      await tx`SET LOCAL search_path TO billing_migration_test`;
      await tx`CREATE TABLE "user" (id text PRIMARY KEY, api_plan text NOT NULL DEFAULT 'free', CONSTRAINT user_api_plan_check CHECK (api_plan IN ('free', 'paid')))`;
      await tx`CREATE TABLE usage_policy (id text PRIMARY KEY, request_limit integer NOT NULL)`;
      await tx`INSERT INTO "user" VALUES ('old-basic', 'free'), ('old-paid', 'paid')`;
      await tx`INSERT INTO usage_policy VALUES ('default', 10), ('paid', 60)`;
      await tx.unsafe(migration);
      await tx.unsafe(migration);
      const users = await tx`SELECT api_plan, terms_accepted_at, plan_expires_at FROM "user" ORDER BY id`;
      assert(users.every((user) => user.api_plan === "free" && user.terms_accepted_at === null && user.plan_expires_at === null));
      const policies = await tx`SELECT id, request_limit FROM usage_policy ORDER BY request_limit`;
      assert.deepEqual(policies.map((row) => [row.id, row.request_limit]), [["default", 10], ["personal", 300], ["professional", 500]]);
    } finally { await tx`DROP SCHEMA billing_migration_test CASCADE`; }
  });
});
