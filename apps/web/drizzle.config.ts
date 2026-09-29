import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: "../../.env" });
dotenv.config();

export default defineConfig({
  schema: "../../packages/db/src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DB_CONNECTION_URL ?? "postgresql://stock_market:stock_market@localhost:5432/stock_market",
  },
});
