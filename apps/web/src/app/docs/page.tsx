import { apiReference } from "../../lib/api-reference";
import { ApiExplorer, type ApiSpec } from "./api-explorer";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API Documentation & Playground | Ledgerline",
  description: "Explore Ledgerline's Indian stock market REST API. Test endpoints, inspect response schemas, and copy cURL, JavaScript and Python examples for financial data.",
};

export default function DocsPage() {
  const swagger = apiReference();
  const initialServer = process.env.NEXT_PUBLIC_API_URL || (process.env.ENVIRONMENT === "dev"
    ? `http://localhost:${process.env.API_PORT || "8787"}` : swagger.servers[0]!.url);
  return <ApiExplorer spec={swagger as unknown as ApiSpec} initialServer={initialServer} />;
}
