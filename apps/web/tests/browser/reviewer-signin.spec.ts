import { test, expect } from "@playwright/test";

test("reviewer URL is unlinked, noindex, and signs in an admin-provisioned account", async ({ page, request }) => {
  test.setTimeout(60_000);
  test.skip(!process.env.INTEGRATION_DATABASE_URL, "Use pnpm test:e2e for seeded credentials");
  await page.goto("/signin");
  await expect(page.locator('a[href="/reviewer/signin"]')).toHaveCount(0);
  await page.goto("/reviewer/signin");
  await expect(page.getByRole("heading", { name: "Reviewer sign in" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("button", { name: /Google|Create account|Sign up/i })).toHaveCount(0);
  await page.getByLabel("Email address").fill("dev@auenkr.com");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not sign in" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("test-development-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The CI dev server compiles the protected dashboard on its first visit.
  await expect(page).toHaveURL(/\/dashboard\/keys$/, { timeout: 30_000 });
  const signup = await request.post("/api/auth/sign-up/email", { data: { name: "Uninvited", email: "uninvited@example.test", password: "must-not-create-an-account" } });
  expect(signup.status()).toBe(400);
});
