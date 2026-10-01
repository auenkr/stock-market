import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DB_CONNECTION_URL) {
  throw new Error("DB_CONNECTION_URL is required to apply the API-key encryption migration");
}

const sql = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  const migration = await readFile(new URL("../migrations/0002_api_key_encrypted_secret.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  console.log("API-key encrypted-secret column is ready.");
} finally {
  await sql.end();
}
