import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DB_CONNECTION_URL) {
  throw new Error("DB_CONNECTION_URL is required to apply the onboarding migration");
}

const sql = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  const migration = await readFile(new URL("../migrations/0001_user_onboarding.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
  console.log("Onboarding migration applied; existing users retain dashboard access.");
} finally {
  await sql.end();
}
