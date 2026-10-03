import { apiReference } from "../../lib/api-reference";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(apiReference(), { headers: { "Cache-Control": "no-store" } });
}
