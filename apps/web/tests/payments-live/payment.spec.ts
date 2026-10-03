import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { db } from "@stock-market/db";
import { createPolarCore } from "@polar-sh/sdk/2026-10";
import { getStateExternalCustomers } from "@polar-sh/sdk/2026-10/services/customers";

const email = "dev@auenkr.com";
const password = "test-development-password";
let userId: string;
let keyName: string;
let existingSubscriptions = new Set<string>();
const cliEnvironment = { ...process.env };
delete cliEnvironment.POLAR_ACCESS_TOKEN;
const client = createPolarCore({ accessToken: process.env.POLAR_ACCESS_TOKEN || "", environment: "sandbox" });
const state = () => getStateExternalCustomers(client)(userId);
function sandboxOrganization() {
  const active = spawnSync("polar", ["auth", "whoami"], { env: cliEnvironment, encoding: "utf8" });
  expect(active.status, "Log the Polar CLI into sandbox for subscription cleanup").toBe(0);
  const output = stripVTControlCharacters(active.stdout);
  expect(output).toMatch(/Environment\s+sandbox/);
  return output;
}

test.beforeAll(async () => {
  expect(process.env.ENVIRONMENT, "Development password login must be enabled").toBe("dev");
  expect(process.env.POLAR_ACCESS_TOKEN).toBeTruthy();
  expect(process.env.DEV_BILLING_EMAIL).toBeTruthy();
  expect(["localhost", "127.0.0.1"]).toContain(new URL(process.env.BETTER_AUTH_URL!).hostname);
  sandboxOrganization();
  const [account] = await db.$client`SELECT id FROM "user" WHERE email=${email}`;
  expect(account, "Run DEV_PASSWORD=test-development-password pnpm db:seed:dev first").toBeTruthy();
  userId = account!.id as string;
});
test.beforeEach(async () => {
  keyName = `Live payment test ${randomUUID()}`;
  const current = await state();
  existingSubscriptions = new Set(current.active_subscriptions.map((subscription) => subscription.id));
  expect(existingSubscriptions.size, "The dev customer must start on Hobby; existing subscriptions are never removed by setup").toBe(0);
});
test.afterEach(async ({ request }) => {
  if (!userId) return;
  try {
    const current = await state();
    for (const subscription of current.active_subscriptions) {
      if (existingSubscriptions.has(subscription.id)) continue;
      expect([process.env.POLAR_SANDBOX_BASIC_PRODUCT_ID, process.env.POLAR_SANDBOX_PERSONAL_PRODUCT_ID, process.env.POLAR_SANDBOX_PROFESSIONAL_PRODUCT_ID]).toContain(subscription.product_id);
      expect(sandboxOrganization()).toContain(current.organization_id);
      const revoked = spawnSync("polar", ["subscriptions", "revoke", subscription.id, "--confirm"], { env: cliEnvironment, encoding: "utf8", timeout: 30_000 });
      expect(revoked.status, `Sandbox subscription cleanup failed: ${revoked.stderr}`).toBe(0);
    }
    await expect.poll(async () => (await state()).active_subscriptions.length, { timeout: 30_000 }).toBe(existingSubscriptions.size);
    if (!existingSubscriptions.size) {
      await expect.poll(async () => {
        const [account] = await db.$client`SELECT api_plan FROM "user" WHERE id=${userId}`;
        return account!.api_plan;
      }, { timeout: 45_000 }).toBe("free");
    }
  } finally {
    await db.$client`DELETE FROM api_key WHERE user_id=${userId} AND name=${keyName}`;
  }
});
test.afterAll(async () => { await db.$client.end(); });
async function access(request: APIRequestContext, key: string) {
  const body = JSON.stringify({ key }); const timestamp = String(Date.now());
  const secret = process.env.ACCOUNT_SERVICE_SECRET || createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET}:account-access-v1`).digest("hex");
  const response = await request.post("/api/internal/account-access", { data: body, headers: { "content-type": "application/json",
    "X-Account-Timestamp": timestamp, "X-Account-Signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex") } });
  expect(response.status()).toBe(200); return response.json();
}

for (const plan of ["Basic", "Personal", "Professional"] as const) {
  test(`real sandbox ${plan} payment: checkout, paid order, webhook activation, and cleanup`, async ({ page, request }) => {
    const origin = process.env.BETTER_AUTH_URL!;
    const login = await page.request.post("/api/auth/sign-in/email", { headers: { origin }, data: { email, password } });
    expect(login.status(), "Seed the dev account with test-development-password").toBe(200);
    await page.goto("/dashboard/billing");
    if (await page.getByRole("button", { name: "Accept policies" }).count()) {
      await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Accept policies" }).click();
    }
    const created = await page.request.post("/api/keys", { data: { name: keyName, expiration: "1d" } });
    expect(created.status()).toBe(201); const { key } = await created.json();
    expect((await access(request, key)).plan).toBe("free");
    await page.getByRole("button", { name: `Subscribe to ${plan}`, exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/sandbox\.polar\.sh\/checkout\//);
    await expect(page.getByText("Ledgerline " + plan, { exact: true })).toBeVisible({ timeout: 60_000 });
    const card = page.frameLocator('iframe[title="Secure payment input frame"]');
    await expect(page.getByRole("button", { name: "Subscribe now", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Subscribe now", exact: true }).click();
    const returned = await page.waitForURL((url) => url.origin === new URL(origin).origin && url.pathname === "/dashboard/billing" && url.searchParams.get("checkout") === "success", { timeout: 25_000 }).then(() => true).catch(() => false);
    if (!returned) {
      await expect(card.getByRole("textbox", { name: "Card number", exact: true })).toBeVisible({ timeout: 45_000 });
      await card.getByRole("textbox", { name: "Card number", exact: true }).fill("4000000000000002");
      await card.getByRole("textbox", { name: /Expiration|Expiry/i }).fill("1230");
      await card.getByRole("textbox", { name: /Security code|CVC/i }).fill("123");
      await page.getByLabel("Cardholder name").fill("Ledgerline Sandbox Tester");
      await page.getByTestId("billing-country").click();
      await page.getByRole("option", { name: "India", exact: true }).click();
      const postal = page.getByRole("textbox", { name: /Postal|ZIP/i });
      if (await postal.count()) await postal.first().fill("560001");
      await page.getByRole("button", { name: "Subscribe now", exact: true }).click();
      await expect.poll(async () => `${await page.locator("body").innerText()} ${await card.locator("body").innerText()}`).toMatch(/declin/i);
      expect((await access(request, key)).plan).toBe("free");
      expect((await state()).active_subscriptions.length).toBe(0);
      await card.getByRole("textbox", { name: "Card number", exact: true }).fill("4242424242424242");
      await card.getByRole("textbox", { name: /Expiration|Expiry/i }).fill("1230");
      await card.getByRole("textbox", { name: /Security code|CVC/i }).fill("123");
      await page.getByRole("button", { name: "Subscribe now", exact: true }).click();
    }
    await expect(page).toHaveURL((url) => url.origin === new URL(origin).origin && url.pathname === "/dashboard/billing" && url.searchParams.get("checkout") === "success", { timeout: 60_000 });
    await expect.poll(async () => {
      const [account] = await db.$client`SELECT api_plan FROM "user" WHERE id=${userId}`; return account!.api_plan;
    }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe(plan.toLowerCase());
    // No status refresh here: the registered ngrok webhook must activate access.
    await page.reload(); await expect(page.getByText(`Your current plan is ${plan}.`, { exact: false })).toBeVisible();
    expect((await access(request, key)).plan).toBe(plan.toLowerCase());
    const current = await state();
    expect(current.active_subscriptions).toHaveLength(1);
    expect(current.active_subscriptions[0]!.currency).toBe("inr");
    expect(current.active_subscriptions[0]!.recurring_interval).toBe("month");
    expect(current.active_subscriptions[0]!.amount).toBe({ Basic: 19900, Personal: 39900, Professional: 249900 }[plan]);
    const orders = await page.request.get("/api/auth/customer/orders/list");
    expect(orders.status()).toBe(200);
    const receipt = await orders.json();
    expect(receipt.items.some((order: { status: string; paid?: boolean }) => order.status === "paid" || order.paid === true)).toBe(true);
    await page.getByRole("link", { name: "API keys", exact: true }).click();
    await expect(page.getByText(`${{ Basic: 60, Personal: 300, Professional: 500 }[plan]} requests / minute per account`, { exact: true })).toBeVisible();
  });
}
