import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

const query = "Market Capitalization > 500 AND Price to Earning < 15";
const cliRoot = fileURLToPath(new URL("../", import.meta.url));
let api: Server;
let apiUrl: string;
let received: { path: string; apiKey?: string } | undefined;

before(async () => {
  api = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    received = { path: url.pathname + url.search, apiKey: req.headers["x-api-key"] as string | undefined };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ query: url.searchParams.get("query"), count: 1, columns: ["Order", "Company", "P/E"], data: [{ Order: 1, Company: "Example Industries", Symbol: "/company/EXAMPLE/", "P/E": 12.4 }] }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
});

test("CLI runs a screen query through the generated API tool and returns structured JSON", async () => {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "get_api_v1_screen", "--query", query], {
      cwd: cliRoot,
      env: { ...process.env, LEGERLINE_API_KEY: "screen-test-key", LEGERLINE_API_URL: apiUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(received?.apiKey, "screen-test-key");
  assert.equal(new URL(`http://localhost${received?.path}`).pathname, "/api/v1/screen");
  assert.equal(new URL(`http://localhost${received?.path}`).searchParams.get("query"), query);
  assert.deepEqual(JSON.parse(result.stdout), {
    query,
    count: 1,
    columns: ["Order", "Company", "P/E"],
    data: [{ Order: 1, Company: "Example Industries", Symbol: "/company/EXAMPLE/", "P/E": 12.4 }],
  });
});
