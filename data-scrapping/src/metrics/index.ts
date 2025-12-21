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
  const csvHeaders = [
    "companyFileName",
    "timePeriod",
    "currentPrice",
    "forecastPrice",
    "deltaPricePercentage",
    "expectedSellingPrice",
    "potentialMaxGain",
    "marketCap",
    "enterpriseValue",
    "annualEbita",
    "evEbitaRatio",
    "growthRate",
    "avgWeightedGrowthRate",
    "forecastEbita",
    "forecastEV",
    "outStandingShares",
  ];

  const csvRows: string[] = [csvHeaders.join(",")];

  results.sort((a, b) => {
    const aLastGain = a && a.length > 0 ? a[a.length - 1]?.potentialMaxGain ?? 0 : 0;
    const bLastGain = b && b.length > 0 ? b[b.length - 1]?.potentialMaxGain ?? 0 : 0;
    return bLastGain - aLastGain;
  });

  results.forEach((companyResults) => {
    companyResults?.forEach((result) => {
      const row = [
        result.companyFileName,
        result.timePeriod,
        result.currentPrice.toFixed(2),
        result.forecastPrice.toFixed(2),
        result.deltaPricePercentage.toFixed(2),
        result.expectedSellingPrice.toFixed(2),
        result.potentialMaxGain.toFixed(2),
        result.marketCap,
        result.enterpriseValue,
        result.annualEbita,
        result.evEbitaRatio.toFixed(2),
        result.growthRate.toFixed(2),
        result.avgWeightedGrowthRate.toFixed(2),
        result.forecastEbita,
        result.forecastEV,
        result.outStandingShares,
      ].join(",");
      csvRows.push(row);
    });
    csvRows.push("");
    csvRows.push("");
  });
  
  console.log(`Failed ${failedResults.length} companies:`);
  writeFileSync(allEVAndEBITAValuationResultFailedFile, JSON.stringify(failedResults, null, 2), "utf8");

  writeFileSync(allEVAndEBITAValuationResultFile, csvRows.join("\n"), "utf8");
  console.log(`Results saved to ${allEVAndEBITAValuationResultFile}: ${results.length} companies`);
}

getEVAndEBITAValuation();
