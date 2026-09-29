import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DB_CONNECTION_URL ??
  "postgresql://stock_market:stock_market@localhost:5432/stock_market";

const client = postgres(connectionString, { max: 5, prepare: false });
export const db = drizzle(client, { schema });
export type Database = typeof db;
export * from "./schema.js";
