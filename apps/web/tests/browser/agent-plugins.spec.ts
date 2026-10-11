import { expect, test } from "@playwright/test";

const pluginCommands = "claude plugin marketplace add AuenKr/ledgerline-claude-plugins\nclaude plugin install ledgerline@ledgerline-claude";
const mcpEndpoint = "https://stock-market-mcp.auenkr.com/mcp";

test("documentation documents ChatGPT, Claude Code and plugin installs", async ({ page }) => {
  await page.goto("/documentation");
  const nav = page.getByRole("navigation", { name: "On this page" });
  for (const label of ["ChatGPT", "Claude Code", "Plugins"]) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();

  await expect(page.locator("#chatgpt")).toContainText("Apps & connectors");
  await expect(page.locator("#chatgpt")).toContainText("/connect/chatgpt");
  await expect(page.locator("#chatgpt")).toContainText("market:read");
  // The ChatGPT app is not published yet, so the page must not promise an install.
  await expect(page.locator("#chatgpt")).toContainText(/in review at OpenAI/i);

  await expect(page.locator("#claude-code")).toContainText(pluginCommands.split("\n")[0]!);
  await expect(page.locator("#claude-code")).toContainText("/mcp");
  await expect(page.locator("#plugins")).toContainText("In review at OpenAI");
  await expect(page.locator("#plugins")).toContainText("Available now");
  await expect(page.locator("#plugins")).toContainText("AuenKr/ledgerline-claude-plugins");
});

test("documentation sections are reachable from the hero and nav anchors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/documentation");
  await page.getByRole("link", { name: "Use with Claude Code" }).click();
  await expect(page).toHaveURL(/#claude-code$/);
  await expect.poll(() => page.locator("#claude-code").evaluate((e) => Math.abs(e.getBoundingClientRect().top - 28))).toBeLessThan(3);
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Plugins", exact: true }).click();
  await expect(page).toHaveURL(/#plugins$/);
});

test("MCP configuration switches per client and always declares a transport type", async ({ page }) => {
  await page.goto("/documentation");
  const tabs = page.locator("#mcp-get-started .mcp-config-tabs-bar button");
  await expect(tabs).toHaveText(["Claude Code", "ChatGPT", "Cursor & others"]);

  const code = page.locator("#mcp-get-started .mcp-config-tabs pre code");
  await expect(code).toContainText("claude mcp add --transport http ledgerline");

  await tabs.filter({ hasText: "ChatGPT" }).click();
  await expect(code).toContainText('"type": "streamable-http"');

  await tabs.filter({ hasText: "Cursor & others" }).click();
  await expect(code).toContainText('"type": "http"');
  await expect(code).not.toContainText("Authorization");
  // A `url` with no `type` is rejected by Claude Code, so every config needs one.
  expect(JSON.parse((await code.innerText()).replace(/ /g, " "))).toMatchObject({
    mcpServers: { ledgerline: { type: "http", url: mcpEndpoint } },
  });
});

test("a copied MCP config is valid, transport-complete JSON", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/documentation");
  await page.locator("#mcp-get-started .mcp-config-tabs-bar button").filter({ hasText: "ChatGPT" }).click();
  await page.locator("#mcp-get-started .mcp-config-tabs .copy-button").click();
  await expect(page.locator("#mcp-get-started .mcp-config-tabs .copy-button")).toContainText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toMatchObject({
    mcpServers: { ledgerline: { type: "streamable-http", url: mcpEndpoint } },
  });
});

test("code blocks are highlighted rather than plain text", async ({ page }) => {
  await page.goto("/documentation");
  // A shell block colours the command name; a JSON block colours keys and strings.
  const shell = page.locator("#claude-code .documentation-code pre code").first();
  await expect(shell.locator(".syntax-key").first()).toBeVisible();
  await expect(shell).toContainText("claude plugin install");

  const json = page.locator("#chatgpt .documentation-code pre code").first();
  await expect(json.locator(".syntax-key").first()).toBeVisible();
  await expect(json.locator(".syntax-string").first()).toBeVisible();
  await expect(json.locator(".syntax-punct").first()).toBeVisible();

  // Highlighting must not alter what a reader copies or reads.
  expect((await json.innerText()).replace(/ /g, " ")).toBe(JSON.stringify({
    mcpServers: { ledgerline: { type: "streamable-http", url: mcpEndpoint } },
  }, null, 2));
});

test("home screen offers the assistants section and per-assistant code tabs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#assistants")).toContainText("ChatGPT and Claude");
  await expect(page.locator("#assistants")).toContainText("claude plugin install ledgerline@ledgerline-claude");
  await expect(page.locator("#assistants a[href='/documentation#chatgpt']")).toBeVisible();
  await expect(page.locator("#assistants a[href='/documentation#claude-code']")).toBeVisible();

  const tabs = page.locator(".product-code-tabs button");
  await expect(tabs).toHaveText(["REST", "Claude Code", "ChatGPT", "MCP", "CLI"]);
  const code = page.locator(".product-code-body pre code");

  await tabs.filter({ hasText: "Claude Code" }).click();
  await expect(code).toContainText("claude mcp add --transport http ledgerline");
  await expect(page.locator(".product-code-bottom")).toContainText("Then run /mcp and authenticate");

  await tabs.filter({ hasText: "ChatGPT" }).click();
  await expect(code).toContainText('"type": "streamable-http"');

  await tabs.filter({ hasText: "MCP" }).click();
  await expect(code).toContainText('"type": "http"');

  await tabs.filter({ hasText: "CLI" }).click();
  await expect(code).toContainText("legerline get_v1_company_search");

  await tabs.filter({ hasText: "REST" }).click();
  await expect(code).toContainText("X-API-Key");
  await expect(page.locator(".product-code-body .copy-button")).toBeVisible();
});

test("home screen explains ChatGPT and Claude in the FAQ", async ({ page }) => {
  await page.goto("/");
  await page.locator("#faq").scrollIntoViewIfNeeded();
  const open = async (question: string) => {
    await page.locator("#faq .faq-item button").filter({ hasText: question }).click();
    return page.locator("#faq .faq-item").filter({ hasText: question });
  };

  const assistants = await open("Can I use Ledgerline with ChatGPT or Claude?");
  await expect(assistants).toContainText("OAuth");
  await expect(assistants).toContainText("Apps & connectors");

  const plugin = await open("How do I install the Ledgerline plugin?");
  await expect(plugin).toContainText("claude plugin install ledgerline@ledgerline-claude");
  await expect(plugin).toContainText("in review at OpenAI");
});
