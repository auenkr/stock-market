import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

test("MCP account linking signs in, displays consent, and returns a PKCE code", async ({ page, request }) => {
  test.skip(!process.env.INTEGRATION_DATABASE_URL, "Use pnpm test:e2e for the disposable database");
  test.setTimeout(60_000);
  const callback = "https://chatgpt.com/connector/oauth/browser-test";
  const registration = await request.post("/api/auth/oauth2/register", { data: {
    client_name: "ChatGPT browser test", redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "market:read offline_access",
  } });
  expect([200,201]).toContain(registration.status());
  const discovery = await request.get("/.well-known/oauth-authorization-server/api/auth");
  expect(discovery.status()).toBe(200);
  expect((await discovery.json()).issuer).toBe("http://127.0.0.1:3105/api/auth");
  const { client_id } = await registration.json();
  const verifier = "b".repeat(64);
  const query = new URLSearchParams({ client_id, redirect_uri: callback, response_type: "code", scope: "market:read offline_access", state: "browser-state", resource: "https://stock-market-mcp.auenkr.com/mcp", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  await page.goto(`/api/auth/oauth2/authorize?${query}`);
  await expect(page.getByRole("heading", { name: "Connect Ledgerline." })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("dev");
  await page.getByLabel("Password", { exact: true }).fill("test-development-password");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page).toHaveURL(/\/connect\/chatgpt\/consent\?/);
  await expect(page.getByRole("heading", { name: "Connect ChatGPT browser test" })).toBeVisible();
  await expect(page.getByText("Read company fundamentals using your account's access and shared request allowance", { exact: true })).toBeVisible();
  await expect(page.getByText("The connection cannot trade", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Allow connection" })).toBeEnabled();
  await page.screenshot({ path: "test-results/mcp-oauth-consent.png", fullPage: true });
  await page.route(`${callback}**`, route => route.fulfill({ contentType: "text/html", body: "<h1>OAuth callback</h1>" }));
  await page.getByRole("button", { name: "Allow connection" }).click();
  await expect(page).toHaveURL(/chatgpt\.com\/connector\/oauth\/browser-test/);
  const redirect = new URL(page.url());
  expect(redirect.searchParams.get("state")).toBe("browser-state");
  expect(redirect.searchParams.get("code")).toBeTruthy();
  const token = await request.post("/api/auth/oauth2/token", { form: { grant_type: "authorization_code", client_id, code: redirect.searchParams.get("code")!, redirect_uri: callback, code_verifier: verifier, resource: "https://stock-market-mcp.auenkr.com/mcp" } });
  expect(token.status(), await token.text()).toBe(200);
  expect((await token.json()).refresh_token).toBeTruthy();
});

test("MCP login rejects unsigned account-linking queries", async ({ page }) => {
  await page.goto("/connect/chatgpt?client_id=forged&scope=market:read");
  await expect(page.getByRole("heading", { name: "Connect from ChatGPT" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});
