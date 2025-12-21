import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { allCompanyDataDir, companyListFile } from "./utils/constant"; 
import { getAllCompanyData, getAllCompanyList } from "./utils/helper";
import type { CompanyDetailList } from "./helper/getCompanyList";

// --- Example Usage ---
async function main() {
  // Get All company data
  await getAllCompanyData();
  console.log(`Successfully fetched all company data.`);
}

main();

// refactorCompanyList();

// function refactorCompanyList() {
//   const companyList = JSON.parse(readFileSync(companyListFile, "utf8")) as CompanyDetailList[];
//   for (const company of companyList) {
//     if (company.skip === undefined || company.skip === null) {
//       company.skip = false;
//     }
//   }
//   writeFileSync(companyListFile, JSON.stringify(companyList, null, 2));
//   console.log(`Company list file updated at ${companyListFile}`);
// }