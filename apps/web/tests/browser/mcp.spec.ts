import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

test("development login and API key work through the MCP server", async () => {
  test.skip(!process.env.INTEGRATION_DATABASE_URL, "Use pnpm test:e2e for the disposable development stack");
  test.setTimeout(120_000);
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--test", "apps/mcp/tests/e2e.test.ts"], {
      cwd: root,
      env: { ...process.env, WEB_URL: "http://127.0.0.1:3105" },
      timeout: 110_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
  expect(result.code, result.output).toBe(0);
});
