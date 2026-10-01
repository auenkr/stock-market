import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try { loadEnvFile(resolve(root, ".env")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

export function run(args, options = {}) {
  const { command = "pnpm", ...spawnOptions } = options;
  const child = spawn(command, args, { cwd: root, stdio: "inherit", ...spawnOptions });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => { process.exitCode = signal ? 0 : code ?? 1; });
  return child;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(["exec", "nx", "run-many", "-t", "dev", "--parallel=4", "--outputStyle=stream"]);
}
