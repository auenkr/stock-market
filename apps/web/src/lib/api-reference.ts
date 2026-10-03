import "server-only";
import swagger from "../../../../swagger.json";
import { visibleApiReference } from "@stock-market/common/api-reference";

export function apiReference() {
  return visibleApiReference(swagger, process.env.ENVIRONMENT);
}
