import { join } from "path";
import dotenv from "dotenv";

dotenv.config();

// Config for getting data

export const BASE_URL =
  process.env.BASE_URL ||
  "Enter Base URL here, eg: https://www.my-website-testing.com";
export const COOKIE = process.env.COOKIE || "Enter Cookie here";

// Directory for output files
export const outputDir = join(__dirname, "./../../gen");

export const companyListFile = outputDir + "/company-list.json";
export const TotalCompanies = 5176;

// All Company Data File
export const allCompanyDataDir = join(outputDir + "/companyData/");

// Rate Limit values

export const DELAY_BETWEEN_API_REQUEST = 1100;
export const DELAY_BETWEEN_COMPANY_DATA_REQUEST = 2000;
export const DELAY_BETWEEN_ERROR_REQUEST = 8000;
