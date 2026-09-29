import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
export { BASE_URL, COOKIE, API_PORT, ORCHESTRATOR_PORT } from "./env.js";

dotenv.config();

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const outputDir = join(repositoryRoot, "gen");
export const companyListFile = join(outputDir, "company-list.json");
export const upcomingIpoFile = join(outputDir, "upcoming-ipo.json");
export const allCompanyDataDir = join(outputDir, "companyData");
export const allEVAndEBITAValuationResultFile = join(
  outputDir,
  "evAndEBITAValuationResult.csv",
);
export const allEVAndEBITAValuationResultFailedFile = join(
  outputDir,
  "evAndEBITAValuationResultFailed.json",
);
