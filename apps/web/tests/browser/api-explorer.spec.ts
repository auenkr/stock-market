import { expect, test, type Page } from "@playwright/test";

const apiServer = "https://api-workspace.test";
const endpoint = (page: Page, name: string) => page.getByRole("navigation", { name: "API operations" }).getByRole("button", { name, exact: false });

test("endpoint navigation restores inputs and responses without repeating requests", async ({ page }) => {
  const requests: string[] = [];
  await page.route(`${apiServer}/**`, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const denied = url.pathname.includes("company-profile") && requests.length === 2;
    await route.fulfill({ status: denied ? 403 : 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "X-Request-ID": `request-${requests.length}` }, body: JSON.stringify({ result: denied ? "Paid access required" : `Response ${requests.length}`, query: url.searchParams.get("q"), path: url.pathname }) });
  });
  await page.goto("/docs");
  await page.getByRole("textbox", { name: "API server" }).fill(apiServer);
  await page.locator("#param-q").fill("cached company search");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".live-response pre")).toContainText("Response 1");
  await expect(page.locator(".response-request-url")).toContainText("q=cached+company+search");

  await endpoint(page, "Company profile").click();
  await page.locator("#param-symbol").fill("/company/RELIANCE/consolidated/");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".live-response")).toContainText("HTTP 403");
  await expect(page.locator(".live-response pre")).toContainText("Paid access required");

  await endpoint(page, "Search companies by name").click();
  await expect(page.locator("#param-q")).toHaveValue("cached company search");
  await expect(page.locator(".live-response pre")).toContainText("Response 1");
  await expect(page.locator(".live-response")).toContainText("HTTP 200");
  expect(requests).toHaveLength(2);

  await page.goBack();
  await expect(page.locator("#param-symbol")).toHaveValue("/company/RELIANCE/consolidated/");
  await expect(page.locator(".live-response pre")).toContainText("Paid access required");
  expect(requests).toHaveLength(2);

  // Only explicitly sending again replaces this endpoint's cached result.
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".live-response pre")).toContainText("Response 3");
  await endpoint(page, "Search companies by name").click();
  await expect(page.locator(".live-response pre")).toContainText("Response 1");
  await endpoint(page, "Company profile").click();
  await expect(page.locator(".live-response pre")).toContainText("Response 3");
  expect(requests).toHaveLength(3);
});

test("the reference groups the revised API and exposes only symbol for Finance", async ({ page }) => {
  await page.goto("/docs");
  const navigation = page.getByRole("navigation", { name: "API operations" });
  const contract = await (await page.request.get("/swagger.json")).json();
  const internal = contract["x-user-journey"].some((group: { id: string }) => group.id === "internal");
  expect(internal).toBe((process.env.ENVIRONMENT ?? "dev") === "dev");
  await expect(navigation.getByRole("heading", { level: 3 })).toHaveText(["1. Search", "2. Company overview", "3. Finance", ...(internal ? ["4. Internal"] : [])]);
  await expect(navigation.getByRole("button", { name: /^List companies / })).toBeVisible();
  for (const name of ["Peer comparison", "Quarterly profit and loss", "Profit and loss", "Balance sheet", "Cash flow", "Ratios", "Shareholding pattern", "Shareholding distribution"]) {
    await navigation.getByRole("button", { name: new RegExp(`^${name} `) }).click();
    await expect(page.locator("input[id^='param-']")).toHaveCount(1);
    await expect(page.locator("#param-symbol")).toHaveValue("/company/RELIANCE/consolidated/");
    await expect(page.locator(".operation-path")).not.toContainText("{symbol}");
  }
  await endpoint(page, "Company documents").click();
  await expect(page.locator("input[id^='param-']")).toHaveCount(1);
  for (const name of ["Stock symbols", "Company search by sector", "Daily quote", "Quote (New)", "Company reports", "Credit ratings", "Investor presentations", "Name changes", "Symbol changes", "Revenue by segment", "Notes", "Financial metrics", "Submission of declarations", "Significant beneficial owners", "Index master", "Index current market price", "Index price returns", "Commodity lookup", "Commodity percentage change", "IPO calendar", "Holiday calendar"]) await expect(navigation.getByRole("button", { name, exact: false })).toHaveCount(0);
  if (internal) {
    await endpoint(page, "Get detailed company data").click();
    await expect(page.locator("#param-symbol")).toBeVisible(); await expect(page.locator("#param-companyUrl")).toHaveCount(0);
    await endpoint(page, "Company corporate actions").click();
    await expect(page.getByRole("combobox", { name: "action", exact: true })).toBeVisible();
  } else {
    await expect(navigation.getByRole("button", { name: /^List upcoming IPOs / })).toHaveCount(0);
    await expect(navigation.getByRole("button", { name: /^Results calendar / })).toHaveCount(0);
    expect(contract.components.schemas.LegacyCompanyData).toBeUndefined();
  }
});

test("requests finish in their own endpoint workspace while viewing another endpoint", async ({ page }) => {
  let searchRequests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`${apiServer}/**`, async (route) => {
    const search = new URL(route.request().url()).pathname === "/v1/company-search";
    if (search) { searchRequests++; await pending; }
    await route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ result: search ? "Delayed search response" : "Profile response" }) });
  });
  try {
    await page.goto("/docs");
    await page.getByRole("textbox", { name: "API server" }).fill(apiServer);
    await page.locator("#param-q").fill("pending search");
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await expect.poll(() => searchRequests).toBe(1);
    await endpoint(page, "Company profile").click();
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(page.locator(".live-response pre")).toContainText("Profile response");

    await endpoint(page, "Search companies by name").click();
    await expect(page.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(page.locator("#param-q")).toHaveValue("pending search");
    await endpoint(page, "Company profile").click();
    release();
    await expect(page.locator(".live-response pre")).toContainText("Profile response");
    await endpoint(page, "Search companies by name").click();
    await expect(page.locator(".live-response pre")).toContainText("Delayed search response");
    await expect(page.getByRole("button", { name: "Send request", exact: true })).toBeEnabled();
    expect(searchRequests).toBe(1);
  } finally { release(); }
});
