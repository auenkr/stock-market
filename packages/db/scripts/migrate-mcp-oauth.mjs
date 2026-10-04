import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";

if (!process.env.DB_CONNECTION_URL) throw new Error("DB_CONNECTION_URL is required");
const sql = postgres(process.env.DB_CONNECTION_URL, { max: 1, prepare: false });
try {
  const migration = await readFile(new URL("../migrations/0012_mcp_oauth.sql", import.meta.url), "utf8");
  await sql.begin(async tx => {
    await tx.unsafe(migration);
    const resource = process.env.MCP_RESOURCE_URL || "https://stock-market-mcp.auenkr.com/mcp";
    if (!/^https?:$/.test(new URL(resource).protocol)) throw new Error("Invalid MCP_RESOURCE_URL");
    await tx`INSERT INTO oauth_resource (id, identifier, name, allowed_scopes, access_token_ttl, created_at, updated_at)
      VALUES (${`mcp-resource-${createHash("sha256").update(resource).digest("hex").slice(0, 24)}`}, ${resource}, 'Ledgerline company fundamentals', ARRAY['market:read'], 300, now(), now())
      ON CONFLICT (identifier) DO NOTHING`;
  });
  console.log("Better Auth MCP OAuth migration applied.");
} finally { await sql.end(); }
