import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { hashPassword } from "better-auth/crypto";
import { createPolarCore } from "@polar-sh/sdk/2026-10";
import { db } from "@stock-market/db";
import { authorizeAccountRequest } from "@stock-market/db/account-access";
import { createAuthOptions } from "../src/config.js";
import { createBillingPlugin, createCheckoutHook, syncBillingAccount } from "../src/polar.js";
import { billingTestEnvironment } from "./billing-fixtures.js";
import { legalVersion } from "../src/consent.js";
import { createPaymentGateway } from "../../../scripts/polar-payment-fixture.mjs";
import { listen, close } from "../../../apps/api/tests/harness.js";

const userId = randomUUID();
const secret = `sm_live_${randomBytes(24).toString("hex")}`;
let auth: { handler: (request: Request) => Promise<Response> };
let cookie: string;
let baseURL: string;
let server: Awaited<ReturnType<typeof listen>>;
let gateway: Awaited<ReturnType<typeof createPaymentGateway>>;
before(async () => {
  assert.match(process.env.INTEGRATION_DATABASE_URL || "", /stock_test_/);
  await db.$client`INSERT INTO "user" (id,name,email,profile_completed,created_at,updated_at) VALUES (${userId}, 'Payment tester', ${`${userId}@payments.invalid`}, true, now(), now())`;
  await db.$client`INSERT INTO api_key (id,user_id,name,key_hash) VALUES (${randomUUID()}, ${userId}, 'Payment key', ${createHash("sha256").update(secret).digest("hex")})`;
  server = await listen(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const result = await auth.handler(new Request(new URL(request.url!, baseURL), { method: request.method, headers: request.headers as Record<string, string>, ...(request.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }));
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text());
  });
  baseURL = server.url;
  gateway = await createPaymentGateway({ webhookUrl: `${baseURL}/api/auth/polar/webhooks` });
  const transport = createPolarCore({ accessToken: "test-polar-token", baseUrl: gateway.url });
  const now = new Date();
  auth = betterAuth({ ...createAuthOptions({ ENVIRONMENT: "dev", BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: "payment-test-session-secret-at-least-thirty-two-characters" }),
    database: memoryAdapter({ user: [{ id: userId, name: "Payment tester", email: "payments@example.org", emailVerified: true, profileCompleted: true, termsAcceptedAt: now, termsVersion: legalVersion, privacyVersion: legalVersion, createdAt: now, updatedAt: now }],
      account: [{ id: randomUUID(), userId, accountId: userId, providerId: "credential", password: await hashPassword("payment-test-password"), createdAt: now, updatedAt: now }], session: [], verification: [] }),
    plugins: [createBillingPlugin(billingTestEnvironment, db.$client, baseURL, transport)!],
    hooks: { before: createCheckoutHook((user) => syncBillingAccount(billingTestEnvironment, db.$client, user, transport)) },
    rateLimit: { enabled: false }, logger: { disabled: true },
  });
  const login = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json" }, body: JSON.stringify({ email: "payments@example.org", password: "payment-test-password" }) }));
  assert.equal(login.status, 200); cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
});
after(async () => { if (gateway) await gateway.close(); if (server) await close(server.server); await db.$client`DELETE FROM "user" WHERE id=${userId}`; await db.$client.end(); });
async function decision() {
  await db.$client`DELETE FROM account_usage WHERE user_id=${userId}`;
  return authorizeAccountRequest(secret, { DB_CONNECTION_URL: process.env.INTEGRATION_DATABASE_URL }, db.$client);
}
async function checkout(slug: string) {
  const response = await fetch(`${baseURL}/api/auth/checkout`, { method: "POST", headers: { cookie, origin: baseURL, "content-type": "application/json" }, body: JSON.stringify({ slug, redirect: false }) });
  assert.equal(response.status, 200, await response.clone().text());
  return new URL((await response.json() as { url: string }).url).pathname.split("/").at(-1)!;
}

for (const plan of ["basic", "personal", "professional"] as const) {
  test(`${plan}: declined payment grants no access; successful retry activates the existing key only after verified payment events`, async () => {
    const id = await checkout(plan);
    assert.deepEqual(await decision(), { status: "allowed", plan: "free" });
    const failed = await gateway.pay(id, "4000000000000002");
    assert.equal(failed.paid, false); assert.equal(failed.order.paid, false);
    assert.equal(gateway.getState(userId).active_subscriptions.length, 0);
    assert.deepEqual(await decision(), { status: "allowed", plan: "free" });
    // Even a signed paid-order notification isn't an entitlement on its own.
    await gateway.emit("order.paid", { ...failed.order, paid: true });
    assert.deepEqual(await decision(), { status: "allowed", plan: "free" });
    const paid = await gateway.pay(id, "4242424242424242");
    assert.equal(paid.paid, true); assert.equal(paid.order.currency, "inr");
    assert.equal(paid.order.amount, { basic: 19900, personal: 39900, professional: 249900 }[plan]);
    assert.deepEqual(await decision(), { status: "allowed", plan });
    const [account] = await db.$client`SELECT plan_expires_at FROM "user" WHERE id=${userId}`;
    assert.equal(new Date(account!.plan_expires_at).toISOString(), gateway.getState(userId).active_subscriptions[0].current_period_end);
    const paidOrders = gateway.orders.filter((order) => order.checkout_id === id && order.paid).length;
    await gateway.pay(id, "4242424242424242");
    assert.equal(gateway.orders.filter((order) => order.checkout_id === id && order.paid).length, paidOrders);
    for (const delivery of gateway.deliveries.filter((entry) => entry.type === "subscription.active" || entry.type === "customer.state_changed").slice(-2)) assert.equal(await gateway.replay(delivery), 200);
    assert.deepEqual(await decision(), { status: "allowed", plan });
    const previousExpiry = new Date(account!.plan_expires_at).getTime();
    const renewal = await gateway.renew(userId, true);
    assert.equal(renewal.billing_reason, "subscription_cycle");
    const [renewed] = await db.$client`SELECT plan_expires_at FROM "user" WHERE id=${userId}`;
    assert(new Date(renewed!.plan_expires_at).getTime() > previousExpiry);
    await gateway.renew(userId, false);
    assert.deepEqual(await decision(), { status: "allowed", plan: "free" });
    await gateway.renew(userId, true);
    assert.deepEqual(await decision(), { status: "allowed", plan });
    await gateway.emit("order.refunded", { ...paid.order, status: "refunded" });
    // Refund notifications cannot invent cancellation; Polar subscription state controls access.
    assert.deepEqual(await decision(), { status: "allowed", plan });
    await gateway.revoke(userId);
    assert.deepEqual(await decision(), { status: "allowed", plan: "free" });
    assert(gateway.deliveries.every((delivery) => delivery.status === 200));
  });
}
