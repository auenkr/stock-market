import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DB_CONNECTION_URL) throw new Error("DB_CONNECTION_URL is required");
const sql = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  const migration = await readFile(new URL("../migrations/0005_application_timestamps.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  console.log("Application timestamps added.");
} finally {
  await sql.end();
}
