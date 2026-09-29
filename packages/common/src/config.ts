import { join } from "node:path";
import dotenv from "dotenv";

dotenv.config();

export const BASE_URL =
  process.env.BASE_URL ||
  "Enter Base URL here, eg: https://www.my-website-testing.com";
export const COOKIE = process.env.COOKIE || "Enter Cookie here";
export const PORT = Number(process.env.PORT ?? 3000);

export const outputDir = join(process.cwd(), "data-scrapping/gen");
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
