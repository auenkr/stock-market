import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const workerBuildOptions = {
  bundle: true,
  conditions: ["source", "workerd"],
  external: ["node:*", "cloudflare:*"],
  alias: Object.fromEntries(builtinModules.filter((name) => !name.startsWith("node:")).map((name) => [name, `node:${name}`])),
  // The Redis SDK's CommonJS modules import native Node APIs. Workers supports
  // createRequire for built-ins under nodejs_compat; keep browser resolution
  // for the existing source/HTTP dependencies.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('file:///worker.js');" },
  format: "esm",
  platform: "browser",
  target: "es2022",
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build({ ...workerBuildOptions, entryPoints: ["src/server.ts"], outfile: "../../dist/apps/api/server.js" });
}
