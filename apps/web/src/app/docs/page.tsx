import swagger from "../../../../../swagger.json";
import { ApiExplorer, type ApiSpec } from "./api-explorer";

export default function DocsPage() {
  return <ApiExplorer spec={swagger as unknown as ApiSpec} initialServer={process.env.NEXT_PUBLIC_API_URL || swagger.servers[0]!.url} />;
}
