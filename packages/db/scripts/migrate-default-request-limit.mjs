import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DB_CONNECTION_URL) throw new Error("DB_CONNECTION_URL is required");
const sql = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  await sql.unsafe(await readFile(new URL("../migrations/0007_default_request_limit.sql", import.meta.url), "utf8"));
  console.log("Default request limit migration applied (10 requests per minute).");
} finally {
  await sql.end();
}
