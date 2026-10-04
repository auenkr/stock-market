import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPaymentGateway } from "./polar-payment-fixture.mjs";

// Keep test/dev servers in the workspace's designated tmux session. A separate
// output directory prevents this server from sharing bundles with either build.
const root = fileURLToPath(new URL("../", import.meta.url));
const generatedInputs = ["apps/web/next-env.d.ts", "apps/web/tsconfig.json"].map((path) => {
  const file = new URL(path, new URL("../", import.meta.url));
  return { file, content: readFileSync(file, "utf8") };
});
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const gateway = process.env.INTEGRATION_DATABASE_URL ? await createPaymentGateway({ webhookUrl: "http://127.0.0.1:3105/api/auth/polar/webhooks" }) : null;
const fixtureEnvironment = gateway ? {
  POLAR_TEST_API_URL: gateway.url,
  NODE_OPTIONS: `--import=${fileURLToPath(new URL("./payment-test-preload.mjs", import.meta.url))}`,
} : {};
const variables = { ...process.env, ...fixtureEnvironment };
const testVariables = ["TEST_MODE", "DB_CONNECTION_URL", "INTEGRATION_DATABASE_URL", "ENVIRONMENT", "DEV_BILLING_EMAIL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "API_KEY_ENCRYPTION_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_SANDBOX_BASIC_PRODUCT_ID", "POLAR_SANDBOX_PERSONAL_PRODUCT_ID", "POLAR_SANDBOX_PROFESSIONAL_PRODUCT_ID", "POLAR_PRODUCTION_BASIC_PRODUCT_ID", "POLAR_PRODUCTION_PERSONAL_PRODUCT_ID", "POLAR_PRODUCTION_PROFESSIONAL_PRODUCT_ID", "POLAR_TEST_API_URL", "NODE_OPTIONS"].filter((key) => variables[key] !== undefined).map((key) => `${key}=${quote(variables[key])}`).join(" ");
if (spawnSync("tmux", ["has-session", "-t", "stock-market"], { stdio: "ignore" }).status !== 0) {
  const session = spawnSync("tmux", ["new-session", "-d", "-s", "stock-market", "-c", root]);
  if (session.status !== 0) process.exit(1);
}
const launched = spawnSync("tmux", ["new-window", "-d", "-P", "-F", "#{window_id}", "-t", "stock-market", "-n", "web-tests", "-c", root,
  `env ${testVariables} WEB_PORT=3105 STOCK_MARKET_NEXT_DIST=.next-theme-tests ${quote(process.execPath)} scripts/dev-app.mjs web`], { encoding: "utf8" });
if (launched.status !== 0) throw new Error("Could not start the browser test server in tmux");
const windowId = launched.stdout.trim();
function cleanup() {
  void gateway?.close();
  spawnSync("tmux", ["kill-window", "-t", windowId], { stdio: "ignore" });
  for (const { file, content } of generatedInputs) writeFileSync(file, content);
}
process.once("exit", cleanup);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {
  if (spawnSync("tmux", ["display-message", "-p", "-t", windowId, "#{window_id}"], { stdio: "ignore" }).status !== 0) {
    console.error("Browser test server exited unexpectedly"); process.exit(1);
  }
}, 1000);
