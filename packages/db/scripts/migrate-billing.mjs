import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DB_CONNECTION_URL) throw new Error("DB_CONNECTION_URL is required");
const sql = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  const migration = await readFile(new URL("../migrations/0010_billing_and_consent.sql", import.meta.url), "utf8");
  await sql.begin(async (tx) => { await tx.unsafe(migration); });
  console.log("Billing plans and legal consent migration applied.");
} finally { await sql.end(); }
