import { expect, type APIRequestContext } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { db } from "@stock-market/db";
import { legalVersion } from "@stock-market/auth/consent";
import { test } from "./database-fixture";

const password = "isolated-payment-browser-password";
let userId: string;
let email: string;
test.beforeEach(async () => {
  test.skip(!process.env.INTEGRATION_DATABASE_URL, "Use pnpm test:e2e for isolated payment flows");
  expect(process.env.INTEGRATION_DATABASE_URL).toMatch(/stock_test_/);
  userId = randomUUID(); email = `payment-${userId}@example.org`;
  await db.$client`INSERT INTO "user" (id,name,email,email_verified,profile_completed,terms_accepted_at,terms_version,privacy_version,created_at,updated_at)
    VALUES (${userId}, 'Payment browser tester', ${email}, true, true, now(), ${legalVersion}, ${legalVersion}, now(), now())`;
  await db.$client`INSERT INTO account (id,user_id,account_id,provider_id,password,created_at,updated_at)
    VALUES (${randomUUID()}, ${userId}, ${userId}, 'credential', ${await hashPassword(password)}, now(), now())`;
});
test.afterEach(async () => { if (userId && process.env.INTEGRATION_DATABASE_URL) await db.$client`DELETE FROM "user" WHERE id=${userId}`; });
async function access(request: APIRequestContext, key: string) {
  const body = JSON.stringify({ key }); const timestamp = String(Date.now());
  const secret = createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET}:account-access-v1`).digest("hex");
  const response = await request.post("/api/internal/account-access", { data: body, headers: {
    "content-type": "application/json", "X-Account-Timestamp": timestamp,
    "X-Account-Signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
  } });
  expect(response.status()).toBe(200); return response.json();
}
for (const plan of ["Basic", "Personal", "Professional"] as const) {
  test(`${plan} payment: decline, retry, verified activation, renewal failure/recovery, and revocation`, async ({ page, request }) => {
    test.setTimeout(60_000);
    const origin = "http://127.0.0.1:3105";
    const login = await page.request.post("/api/auth/sign-in/email", { headers: { origin }, data: { email, password } });
    expect(login.status()).toBe(200);
    const created = await page.request.post("/api/keys", { data: { name: "Before payment", expiration: "never" } });
    expect(created.status()).toBe(201); const { key } = await created.json();
    expect((await access(request, key)).plan).toBe("free");
    await page.goto("/dashboard/billing");
    await page.getByRole("button", { name: `Subscribe to ${plan}`, exact: true }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/checkout\//);
    const gateway = new URL(page.url()).origin;
    await expect(page.getByRole("heading", { name: `Ledgerline ${plan.toLowerCase()}` })).toBeVisible();
    await expect(page.getByText(`₹${{ Basic: "199", Personal: "399", Professional: "2,499" }[plan]} / month`, { exact: true })).toBeVisible();
    await page.getByLabel("Card number").fill("4000 0000 0000 0002");
    await page.getByLabel("Expiry").fill("12/30"); await page.getByLabel("CVC").fill("123");
    await page.getByRole("button", { name: "Subscribe now" }).click();
    await expect(page.getByRole("alert")).toHaveText(/card was declined/i);
    expect((await access(request, key)).plan).toBe("free");
    await page.getByLabel("Card number").fill("4242 4242 4242 4242");
    await page.getByLabel("Expiry").fill("12/30"); await page.getByLabel("CVC").fill("123");
    await page.getByRole("button", { name: "Subscribe now" }).click();
    await expect(page).toHaveURL(/\/dashboard\/billing\?checkout=success$/);
    await expect(page.getByText(`Your current plan is ${plan}.`, { exact: false })).toBeVisible();
    expect((await access(request, key)).plan).toBe(plan.toLowerCase());
    await page.getByRole("link", { name: "API keys", exact: true }).click();
    await expect(page.getByText(`${{ Basic: 60, Personal: 300, Professional: 500 }[plan]} requests / minute per account`, { exact: true })).toBeVisible();
    const [before] = await db.$client`SELECT plan_expires_at FROM "user" WHERE id=${userId}`;
    const control = (path: string, data: unknown) => request.post(`${gateway}/__test/${path}`, { headers: { authorization: "Bearer test-polar-token" }, data });
    expect((await control("renew", { externalId: userId, paid: true })).status()).toBe(200);
    const [renewed] = await db.$client`SELECT plan_expires_at FROM "user" WHERE id=${userId}`;
    expect(new Date(renewed!.plan_expires_at).getTime()).toBeGreaterThan(new Date(before!.plan_expires_at).getTime());
    expect((await control("renew", { externalId: userId, paid: false })).status()).toBe(200);
    await page.reload(); await expect(page.getByText("10 requests / minute per account", { exact: true })).toBeVisible();
    expect((await access(request, key)).plan).toBe("free");
    expect((await control("renew", { externalId: userId, paid: true })).status()).toBe(200);
    expect((await access(request, key)).plan).toBe(plan.toLowerCase());
    expect((await control("revoke", { externalId: userId })).status()).toBe(200);
    expect((await access(request, key)).plan).toBe("free");
    await page.goto("/dashboard/billing");
    await expect(page.getByText("Your current plan is Hobby.", { exact: false })).toBeVisible();
  });
}
