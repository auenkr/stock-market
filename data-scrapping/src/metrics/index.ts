import {
  allCompanyDataDir,
  allEVAndEBITAValuationResultFailedFile,
  allEVAndEBITAValuationResultFile,
} from "../utils/constant";
import { readdirSync, writeFileSync } from "node:fs";
import { GetEVAndEBITAValuation } from "./ev-ebita-valuation";

async function getEVAndEBITAValuation() {
  const companyDir = allCompanyDataDir;
  const companyFiles = readdirSync(companyDir);

  console.log(`Found ${companyFiles.length} company files.`);

  const failedResults: { companyFileName: string, error: { name: string, message: string, stack?: string } }[] = [];
  let results = companyFiles.map((companyFile, idx) => {
    try {
      console.log(`Processing ${companyFile} ...`);
      const result = GetEVAndEBITAValuation(companyFile);
      return result;
    } catch (error) {
        if (!(error instanceof Error)) {
            console.error(`Error processing and saving results for ${companyFile}:`, error);
            return;
        }
      failedResults.push({ 
        companyFileName: companyFile, 
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      });
      return;
    }
  });

  if (results.length == 0) {
    console.log("No results found");
    return;
  }
  results = results.filter((each) => each !== undefined);
  const csvHeaders = Object.keys(results[0]![0]!);

  const csvRows: string[] = [csvHeaders.join(",")];

  results.forEach((companyResults) => {
    companyResults?.forEach((result) => {
      const row = [
        result.companyFileName,
        result.timePeriod,
        result.enterpriseValue,
        result.annualEbita,
        result.evEbitaRatio,
        result.growthRate,
        result.avgWeightedGrowthRate,
        result.forecastEbita,
        result.forecastEV,
        result.outStandingShares,
        result.currentPrice,
        result.forecastPrice,
        result.deltaPricePercentage,
      ].join(",");
      csvRows.push(row);
    });
    csvRows.push("");
    csvRows.push("");
  });
  console.log(`Failed ${failedResults.length} companies:`);
  writeFileSync(allEVAndEBITAValuationResultFailedFile, JSON.stringify(failedResults, null, 2), "utf8");

  writeFileSync(allEVAndEBITAValuationResultFile, csvRows.join("\n"), "utf8");
  console.log(`Results saved to ${allEVAndEBITAValuationResultFile}`);
}

getEVAndEBITAValuation();
