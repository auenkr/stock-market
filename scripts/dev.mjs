import { spawn } from "node:child_process";
const children = [spawn("cargo", ["run", "--manifest-path", "apps/api-rs/Cargo.toml"], { stdio: "inherit", env: { ...process.env, ENVIRONMENT: "dev", PORT: process.env.PORT ?? "8787" } }), spawn("pnpm", ["--filter", "@auenkr/legerline-mcp", "start"], { stdio: "inherit" })];
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { for (const child of children) child.kill(signal); });
