import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DB_CONNECTION_URL) throw new Error("DB_CONNECTION_URL is required");
const sql = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  const migration = await readFile(new URL("../migrations/0009_api_plans.sql", import.meta.url), "utf8");
  await sql.begin(async (transaction) => { await transaction.unsafe(migration); });
  console.log("API plans migration applied (free: 10/minute, paid: 60/minute).");
} finally {
  await sql.end();
}
