import swagger from "../../../../../swagger.json";
import { ApiExplorer, type ApiSpec } from "./api-explorer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation & Playground | Ledgerline",
  description: "Explore Ledgerline's Indian stock market REST API. Test endpoints, inspect response schemas, and copy cURL, JavaScript and Python examples for financial data.",
};

export default function DocsPage() {
  return <ApiExplorer spec={swagger as unknown as ApiSpec} initialServer={process.env.NEXT_PUBLIC_API_URL || swagger.servers[0]!.url} />;
}
