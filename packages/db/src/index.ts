import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DB_CONNECTION_URL ??
  "postgresql://stock_market:stock_market@localhost:5432/stock_market";

// Serverless instances multiply pools; keep each small and release idle sockets
// so deployments and bursts fit the database connection budget.
// Node/web consumers may reuse this pool for raw queries as well as Drizzle.
// Workers must keep using request-scoped clients from account-access.ts.
export const sql = postgres(connectionString, { max: 1, idle_timeout: 5, max_lifetime: 60, prepare: false, connect_timeout: 5 });
export const db = drizzle(sql, { schema });
export type Database = typeof db;
export * from "./schema.js";
export { createId } from "./id.js";
