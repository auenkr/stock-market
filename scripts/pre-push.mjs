import { spawnSync } from "node:child_process";
for (const script of ["docs:check", "typecheck", "test:api", "test:auth", "test:keys", "test:integration", "test:e2e"]) {
  const result = spawnSync("pnpm", [script], { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
