import { expect, test } from "@playwright/test";
import nextConfig from "../../next.config";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";

test("production builds cannot overwrite the development server's client bundles", () => {
  const previous = process.env.STOCK_MARKET_NEXT_DIST;
  delete process.env.STOCK_MARKET_NEXT_DIST;
  try { expect(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir).not.toBe(nextConfig(PHASE_PRODUCTION_BUILD).distDir); }
  finally { if (previous === undefined) delete process.env.STOCK_MARKET_NEXT_DIST; else process.env.STOCK_MARKET_NEXT_DIST = previous; }
});

for (const path of ["/", "/documentation", "/docs"]) {
  test(`theme toggles both ways, stays usable, and persists on ${path}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    const failedScripts: string[] = [];
    page.on("response", (response) => { if (response.request().resourceType() === "script" && response.status() >= 400) failedScripts.push(response.url()); });
    await page.goto(path);
    const button = page.locator(".theme-picker button");
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(button).toBeEnabled();
    await expect(button).toHaveAccessibleName("Switch to light mode");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    await page.reload();
    await expect(button).toHaveAccessibleName("Switch to light mode");
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(button).toBeEnabled();
    await expect(button).toHaveAccessibleName("Switch to dark mode");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ledgerline-theme"))).toBe("light");
    expect(failedScripts).toEqual([]);
  });
}

test("system dark theme and reduced motion use the correct instant toggle", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/documentation");
  const button = page.locator(".theme-picker button");
  await expect(button).toHaveAccessibleName("System theme. Switch to light mode");
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(button).toBeEnabled();
  await expect(page.locator("html")).not.toHaveClass(/theme-transition/);
});

test("theme works without View Transitions or writable local storage", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", { value: undefined });
    Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); };
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/documentation");
  const button = page.locator(".theme-picker button");
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("documentation contents scroll smoothly and respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/documentation");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("smooth");
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Rate limits" }).click();
  await expect(page).toHaveURL(/#rate-limits$/);
  await expect.poll(() => page.locator("#rate-limits").evaluate((e) => Math.abs(e.getBoundingClientRect().top - 28))).toBeLessThan(3);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
});
