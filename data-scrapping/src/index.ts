import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { allCompanyDataDir, companyListFile } from "./utils/constant"; 
import { getAllCompanyData, getAllCompanyList } from "./utils/helper";
import type { CompanyDetailList } from "./helper/getCompanyList";

// --- Example Usage ---
async function main() {
  // Get All company list
  let companyList: CompanyDetailList[] = [];
  if (!existsSync(companyListFile)) {
    companyList = await getAllCompanyList();
    console.log(`Successfully fetched ${companyList.length} companies.`);
    writeFileSync(companyListFile, JSON.stringify(companyList, null, 2));
    console.log(`Company list file created at ${companyListFile}`);
  } else {
    console.log(`Company list file already exists. Skipping...`);
    companyList = JSON.parse(readFileSync(companyListFile, "utf8"));
    console.log(`Successfully read ${companyList.length} companies from file.`);
  }

  // Get All company data
  await getAllCompanyData(companyList);
  console.log(`Successfully fetched all company data.`);
}

main();