import { spawnSync } from "node:child_process";
// Run the shared CI checks explicitly; Git pushes do not invoke this script.
// A fresh Actions checkout has no dist exports for docs or runtime imports.
const shared = spawnSync("pnpm", ["--filter", "./packages/**", "--if-present", "build"], { stdio: "inherit" });
if (shared.error) console.error(shared.error.message);
if (shared.status !== 0) process.exit(shared.status ?? 1);
for (const script of ["docs:check", "typecheck", "test:api", "test:auth", "test:keys", "test:integration", "test:e2e"]) {
  const result = spawnSync("pnpm", [script], { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
