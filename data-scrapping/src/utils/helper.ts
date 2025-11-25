import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GetCompanyData, type BaseValueEnum } from "../helper/getCompanyData";
import {
  allCompanyDataDir,
  DELAY_BETWEEN_COMPANY_DATA_REQUEST,
  DELAY_BETWEEN_ERROR_REQUEST,
  TotalCompanies,
} from "./constant";
import type { CompanyDetailList } from "../helper/getCompanyList";
import { getCompanyList } from "../helper/getCompanyList";

export async function getAllCompanyList() {
  const batchSize = 50;
  const companyList: CompanyDetailList[] = [];
  const totalBatches = Math.ceil(TotalCompanies / batchSize);
  console.log(
    `Fetching ${totalBatches} batches of ${batchSize} companies each`
  );
  for (let i = 0; i < totalBatches; i++) {
    const companyDetails = await getCompanyList(batchSize, i + 1);
    companyList.push(...companyDetails);
    console.log(`Total companies fetched: ${companyList.length}`);
    console.log(`Sleeping for 1 second...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return companyList;
}

export async function getAllCompanyData(companyList: CompanyDetailList[]) {
  try {
    let count = 0;
    for (const company of companyList) {
      const fileDir = join(allCompanyDataDir, company.name + ".json");
      if (!existsSync(fileDir)) {
        console.log(
          `${new Date().toISOString()} Fetching data for ${company.name}...`
        );
        const startTime = Date.now();
        const companyData = await GetCompanyData(company.url);
        console.log(`Successfully fetched data for ${company.name}.`);
        console.log(
          `Fecting Time taken: ${Date.now() - startTime} milliseconds`
        );
        writeFileSync(fileDir, JSON.stringify(companyData, null, 2));
        console.log(`Company data file created at ${fileDir}`);
        await new Promise((resolve) =>
          setTimeout(resolve, DELAY_BETWEEN_COMPANY_DATA_REQUEST)
        );
        console.log(
          `Total time taken for ${company.name}: ${
            Date.now() - startTime
          } milliseconds...`
        );
      } else {
        console.log(
          `Company data file already exists. Skipping...`,
          company.name
        );
      }
      count++;
      console.log(`Count: ${count} of ${companyList.length}`);
    }
  } catch (error) {
    console.error(`Error fetching company data:`, error);
    await new Promise((resolve) =>
      setTimeout(resolve, DELAY_BETWEEN_ERROR_REQUEST)
    );
    await getAllCompanyData(companyList);
  }
}

export function GetBaseValue(baseValue: BaseValueEnum): number {
  switch (baseValue) {
    case "one":
      return 1;
    case "ten":
      return 10;
    case "hundred":
      return 100;
    case "thousand":
      return 1000;
    case "lakh":
      return 100000;
    case "crore":
      return 10000000;
    case "percent":
      return 1;
    case "ratio":
      return 1;
    case "none":
      return 0; // 0 is the default base value
    default:
      throw new Error(`Invalid base value: ${baseValue}`);
  }
}