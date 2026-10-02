import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const connectionString = process.env.DB_CONNECTION_URL ??
  "postgresql://stock_market:stock_market@localhost:5432/stock_market";

// Serverless instances multiply pools; keep each small and release idle sockets
// so deployments and bursts fit the database connection budget.
const client = postgres(connectionString, { max: 1, idle_timeout: 5, max_lifetime: 60, prepare: false });
export const db = drizzle(client, { schema });
export type Database = typeof db;
export * from "./schema.js";
export { createId } from "./id.js";
