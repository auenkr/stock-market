// Apply every packages/db/migrations/*.sql in numeric order via its migrate-*.mjs script.
// Idempotent: run after drizzle-kit push or on an already-migrated database.
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

if (!process.env.DB_CONNECTION_URL) throw new Error("DB_CONNECTION_URL is required");
const scriptsDir = new URL(".", import.meta.url);
const entries = [];
for (const file of await readdir(scriptsDir)) {
  const match = /^migrate-([a-z-]+)\.mjs$/.exec(file);
  if (!match || match[1] === "all") continue;
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const sql = /migrations\/(\d+)_[a-z0-9_]+\.sql/.exec(source)?.[1];
  if (sql) entries.push({ sql, file });
}
entries.sort((a, b) => a.sql.localeCompare(b.sql));
for (const { file } of entries) {
  const result = spawnSync(process.execPath, [new URL(file, import.meta.url).pathname], { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`Migration script ${file} failed`);
    process.exit(result.status ?? 1);
  }
}
console.log(`Applied ${entries.length} migrations in order.`);
