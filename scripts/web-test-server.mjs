import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Keep test/dev servers in the workspace's designated tmux session. A separate
// output directory prevents this server from sharing bundles with either build.
const root = fileURLToPath(new URL("../", import.meta.url));
const generatedInputs = ["apps/web/next-env.d.ts", "apps/web/tsconfig.json"].map((path) => {
  const file = new URL(path, new URL("../", import.meta.url));
  return { file, content: readFileSync(file, "utf8") };
});
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
if (spawnSync("tmux", ["has-session", "-t", "stock-market"], { stdio: "ignore" }).status !== 0) {
  const session = spawnSync("tmux", ["new-session", "-d", "-s", "stock-market", "-c", root]);
  if (session.status !== 0) process.exit(1);
}
const launched = spawnSync("tmux", ["new-window", "-d", "-P", "-F", "#{window_id}", "-t", "stock-market", "-n", "web-tests", "-c", root,
  `env WEB_PORT=3105 STOCK_MARKET_NEXT_DIST=.next-theme-tests ${quote(process.execPath)} scripts/dev-app.mjs web`], { encoding: "utf8" });
if (launched.status !== 0) throw new Error("Could not start the browser test server in tmux");
const windowId = launched.stdout.trim();
function cleanup() {
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
