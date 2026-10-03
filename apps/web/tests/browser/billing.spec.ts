import { expect } from "@playwright/test";
import { test } from "./database-fixture";
import { createHash, createHmac } from "node:crypto";
import { db } from "@stock-market/db";
import { customerState, signedEvent } from "../../../../packages/auth/tests/billing-fixtures";

test("pricing and legal documents are linked, monthly, and usable on mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: "Hobby", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Basic", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Professional", exact: true })).toBeVisible();
  for (const price of ["₹199", "₹399", "₹2,499"]) await expect(page.getByText(price, { exact: false })).toBeVisible();
  await expect(page.getByText("Free forever. No payment details needed.")).toBeVisible();
  for (const limit of [10, 60, 300, 500]) await expect(page.getByText(`${limit} requests / minute`, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Terms of Service", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Terms of Service", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payments & cancellation" })).toBeVisible();
  await page.locator("footer").getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your rights", exact: true })).toBeVisible();
});

test("signup requires an unchecked-by-default consent checkbox before starting Google OAuth", async ({ page, context }) => {
  test.skip(!process.env.INTEGRATION_DATABASE_URL, "Run pnpm test:e2e for the disposable configured signup server");
  await page.goto("/signup");
  const checkbox = page.getByRole("checkbox");
  const signup = page.getByRole("button", { name: "Sign up with Google" });
  await expect(checkbox).not.toBeChecked();
  await expect(signup).toBeDisabled();
  await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms-of-service");
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy-policy");
  const oauth = page.waitForRequest((request) => request.url().includes("/sign-in/social"));
  await page.route("https://accounts.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Google test boundary</h1>" }));
  await checkbox.check();
  await expect(signup).toBeEnabled();
  await signup.click();
  const request = await oauth;
  expect(request.postDataJSON().provider).toBe("google");
  await expect(page).toHaveURL(/accounts\.google\.com/);
  const consent = (await context.cookies("http://127.0.0.1:3105")).find((cookie) => cookie.name === "ledgerline.legal-consent");
  expect(consent?.httpOnly).toBe(true);
  expect(consent?.sameSite).toBe("Lax");
});

test("real console and signed Polar webhook upgrade existing keys, downgrade on revocation, and never trust the success URL", async ({ page, request }) => {
  test.skip(process.env.CI === "true", "Webhook lifecycle tests are excluded from CI");
  test.setTimeout(60_000);
  test.skip(!process.env.INTEGRATION_DATABASE_URL, "Run pnpm test:e2e for isolated billing lifecycle coverage");
  const [account] = await db.$client`SELECT id FROM "user" WHERE email = 'dev@auenkr.com'`;
  const userId = account!.id as string;
  await page.goto("/pricing");
  await page.getByRole("link", { name: "Choose Personal", exact: true }).click();
  await expect(page).toHaveURL(/\/signin\?next=/);
  await page.getByLabel("Username", { exact: true }).fill("dev");
  await page.getByLabel("Password", { exact: true }).fill("test-development-password");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page).toHaveURL(/\/dashboard\/billing$/);
  await expect(page.getByText("Your current plan is Hobby.", { exact: false })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept policies" }).click();
  await expect(page.getByRole("button", { name: "Subscribe to Personal" })).toBeEnabled();
  const [accepted] = await db.$client`SELECT terms_accepted_at, terms_version, privacy_version FROM "user" WHERE id = ${userId}`;
  expect(accepted!.terms_accepted_at).toBeTruthy();
  expect(accepted!.terms_version).toBe("2026-10-03");
  expect(accepted!.privacy_version).toBe("2026-10-03");
  await page.goto("/dashboard/billing?checkout=success");
  await expect(page.getByText("Your current plan is Hobby.", { exact: false })).toBeVisible();
  const created = await page.request.post("/api/keys", { data: { name: "Billing browser key", expiration: "never" } });
  expect(created.status()).toBe(201);
  const { key } = await created.json();
  async function decision() {
    const body = JSON.stringify({ key });
    const timestamp = String(Date.now());
    const signingSecret = createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET}:account-access-v1`).digest("hex");
    const response = await request.post("/api/internal/account-access", { data: body, headers: { "content-type": "application/json", "X-Account-Timestamp": timestamp, "X-Account-Signature": createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("hex") } });
    expect(response.status()).toBe(200);
    return response.json();
  }
  expect((await decision()).plan).toBe("free");
  const forged = signedEvent(customerState(userId, "professional"));
  forged.headers["webhook-signature"] = "v1,forged";
  expect((await request.post("/api/auth/polar/webhooks", { data: forged.body, headers: forged.headers })).status()).toBe(403);
  for (const plan of ["basic", "personal", "professional", "free"] as const) {
    const event = signedEvent(customerState(userId, plan));
    const response = await request.post("/api/auth/polar/webhooks", { data: event.body, headers: event.headers });
    expect(response.status(), await response.text()).toBe(200);
    await page.reload();
    await expect(page.getByText(`Your current plan is ${plan === "free" ? "Hobby" : plan === "basic" ? "Basic" : plan === "personal" ? "Personal" : "Professional"}.`, { exact: false })).toBeVisible();
    expect((await decision()).plan).toBe(plan);
  }
  await page.getByRole("link", { name: "API keys", exact: true }).click();
  await expect(page.getByText("10 requests / minute per account", { exact: true })).toBeVisible();
});
