import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = path.join(root, "plugins/ledgerline");
const manifest = JSON.parse(await readFile(path.join(pluginRoot, "plugin.json"), "utf8"));
const mcp = JSON.parse(await readFile(path.join(pluginRoot, "mcp.json"), "utf8"));
const extension = manifest.extensions["com.openai"];
const listing = extension.interface;

assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.ok(manifest.name.length <= 64);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
for (const [field, limit] of Object.entries({ displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80 })) {
  assert.ok(typeof listing[field] === "string" && listing[field].trim() && listing[field].length <= limit, `Invalid ${field}`);
}
for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  const url = new URL(listing[field]);
  assert.equal(url.protocol, "https:");
  assert.ok(!url.username && !url.password && listing[field].length <= 1024, `Invalid ${field}`);
}
assert.equal(Object.keys(mcp.mcpServers).length, 1);
assert.equal(mcp.mcpServers.ledgerline.type, "streamable-http");
assert.equal(mcp.mcpServers.ledgerline.url, "https://stock-market-mcp.auenkr.com/mcp");
assert.equal(extension.review.test_cases.positive.length, 5);
assert.equal(extension.review.test_cases.negative.length, 3);
for (const [kind, cases] of Object.entries(extension.review.test_cases)) {
  for (const testCase of cases) {
    for (const field of ["description", "prompt", "expected_behavior", ...(kind === "positive" ? ["tools_triggered"] : [])]) {
      assert.ok(typeof testCase[field] === "string" && testCase[field].trim(), `Missing ${field}`);
    }
  }
}
const icon = await readFile(path.join(pluginRoot, "assets/icon.svg"), "utf8");
assert.match(icon, /viewBox="0 0 64 64"/);
assert.equal(listing.logo, "./assets/icon.svg");
assert.equal(listing.composerIcon, "./assets/icon.svg");

// Whitelist public package files. Never include environment files or reviewer credentials.
const archive = path.join(root, "dist", `ledgerline-chatgpt-plugin-${manifest.version}.zip`);
await mkdir(path.dirname(archive), { recursive: true });
await rm(archive, { force: true });
execFileSync("zip", ["-q", "-X", archive, "plugin.json", "mcp.json", "assets/icon.svg"], { cwd: pluginRoot });
console.log(`Draft plugin package: ${archive}`);
console.log("Local metadata checks passed. Confirm deployed OAuth, publisher identity, domain verification, reviewer access, tested review cases, and a demo recording in the portal before submission.");
