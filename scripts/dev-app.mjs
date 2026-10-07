import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { root, run } from "./dev.mjs";

const app = process.argv[2];
const cwd = resolve(root, "apps", app);
const require = createRequire(resolve(cwd, "package.json"));
if (app === "api") {
  const bindings = {
    BASE_URL: process.env.BASE_URL ?? "https://www.screener.in",
    COOKIE: process.env.COOKIE ?? "",
    CACHE_ENABLED: process.env.CACHE_ENABLED ?? "true",
    VALKEY_URL: process.env.VALKEY_URL ?? "",
    VALKEY_CACHE_PREFIX: process.env.VALKEY_CACHE_PREFIX ?? "stock-market:dev",
    ACCOUNT_SERVICE_URL: process.env.ACCOUNT_SERVICE_URL ?? `http://localhost:${process.env.WEB_PORT ?? "3001"}/api/internal/account-access`,
    ACCOUNT_SERVICE_SECRET: process.env.ACCOUNT_SERVICE_SECRET ?? (process.env.BETTER_AUTH_SECRET
      ? createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET}:account-access-v1`).digest("hex") : ""),
    PUBLIC_URL: process.env.PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 8787}`,
  };
  try { Object.assign(bindings, parseEnv(readFileSync(resolve(cwd, ".dev.vars"), "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // Pass only API bindings to Wrangler; keep cookies out of argv and logs.
  const directory = mkdtempSync(resolve(tmpdir(), "stock-market-dev-"));
  const file = resolve(directory, ".env");
  writeFileSync(file, Object.entries(bindings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
  const cli = resolve(require.resolve("wrangler/package.json"), "..", "bin/wrangler.js");
  const remoteDev = process.env.API_DEV_REMOTE === "true";
  const args = [cli, "dev", "--port", process.env.API_PORT ?? "8787", "--env-file", file];
  if (remoteDev) args.push("--env", "dev", "--remote");
  const child = run(args, { cwd, command: process.execPath });
  child.once("exit", () => rmSync(directory, { recursive: true, force: true }));
} else if (app === "web") {
  const cli = resolve(require.resolve("next/package.json"), "..", "dist/bin/next");
  run([cli, "dev", "--port", process.env.WEB_PORT ?? "3001"], { cwd, command: process.execPath });
} else if (["orchestrator", "worker"].includes(app)) {
  run(["--conditions=source", "--watch", "--import", "tsx", "src/" + (app === "worker" ? "index" : "server") + ".ts"], { cwd, command: process.execPath });
} else {
  throw new Error(`Unknown dev app: ${app}`);
}
