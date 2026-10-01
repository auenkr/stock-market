const nodeEnv = typeof process === "undefined" ? undefined : process.env;

export const BASE_URL =
  nodeEnv?.BASE_URL ||
  "https://www.screener.in";
export const COOKIE = nodeEnv?.COOKIE || "";
export const API_PORT = Number(nodeEnv?.API_PORT ?? 8787);
export const ORCHESTRATOR_PORT = Number(nodeEnv?.ORCHESTRATOR_PORT ?? 3000);
export const PUBLIC_URL = nodeEnv?.PUBLIC_URL || "http://localhost:8787";
