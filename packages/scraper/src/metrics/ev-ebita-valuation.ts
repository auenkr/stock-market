import type { CompanyDataType } from "../helper/getCompanyData.js";
import { join } from "node:path";
import fs from "node:fs";
import { allCompanyDataDir } from "@stock-market/common/config";
import { getEnterpriseValue, getAnnualEBITA, getShareOutstanding, getCompanyMonthPrice } from "./utils.js";
import { GetBaseValue } from "../utils/helper.js";

function readCompanyData(fileName: string): CompanyDataType {
    const filePath = join(allCompanyDataDir, fileName);
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data) as CompanyDataType;
}

type EVAndEBITAValuationResult = {
  companyFileName: string;
  timePeriod: string;
  enterpriseValue: number;
  annualEbita: number;
  evEbitaRatio: number;
  growthRate: number;
  avgWeightedGrowthRate: number;
  forecastEbita: number;
  forecastEV: number;
  outStandingShares: number;
  currentPrice: number;
  forecastPrice: number;
  deltaPricePercentage: number;
  expectedSellingPrice: number; // 10 % less than potentialMaxGain
  potentialMaxGain: number;
  marketCap: number;
};

export function GetEVAndEBITAValuation(companyFileName: string) : EVAndEBITAValuationResult[] {
  const companyData = readCompanyData(companyFileName);
  if (companyData.skip) {
    throw new Error(`Skipping ${companyFileName} because it is marked as skipped.`);
  }
  
  let timePeriods = companyData.profitAndLossStatements.map((each) => each.timePeriod);
  timePeriods = timePeriods.filter((each) => each !== "TTM");

  let avgWeightedGrowthRate = 0;
  let previousYearForecastPrice = 0;
  let result = timePeriods.map((timePeriod, index) => {
    if (index === 0) {
      return;
    }
    const enterpriseValue = getEnterpriseValue(companyData, timePeriod);
    const annualCurrentYearEbita = getAnnualEBITA(companyData, timePeriod);
    const evEbitaRatio = enterpriseValue.amount / annualCurrentYearEbita.amount;
    const annualPreviousYearEbita = getAnnualEBITA(companyData, timePeriods[index - 1]!);

    // Calculating growth rate for ebita growth rate
    const growthRate = ((annualCurrentYearEbita.amount - annualPreviousYearEbita.amount) / annualPreviousYearEbita.amount) * 100;

    avgWeightedGrowthRate = (avgWeightedGrowthRate*(index-1) + growthRate*(index/timePeriods.length)) / (index);
    const forecastEbita = annualCurrentYearEbita.amount * (1 + avgWeightedGrowthRate/100);
    const forecastEV = forecastEbita * evEbitaRatio;

    const outStandingShares = getShareOutstanding(companyData, timePeriod);
   
    const forecastPrice = forecastEV / (outStandingShares.amount * GetBaseValue(outStandingShares.baseValue));
    
    const metric = companyData.metrics.filter((each) => each.metric === "Price")[0];
    if (!metric) {
      throw new Error("Price metric not found");
    }
    let currentPrice = getCompanyMonthPrice(metric, timePeriod);
    // For latest price
    if (index === timePeriods.length - 1) {
      const currentPriceMetric = companyData.metrics.filter((each) => each.metric === "Price")[0]!
      currentPrice = currentPriceMetric.values[Object.keys(currentPriceMetric.values)[Object.keys(currentPriceMetric.values).length - 1]!]!
    }

    const deltaPricePercentage = (currentPrice.amount * GetBaseValue(currentPrice.baseValue) - previousYearForecastPrice) / previousYearForecastPrice * 100;
    previousYearForecastPrice = forecastPrice;

    const potentialMaxGain = (forecastPrice - currentPrice.amount * GetBaseValue(currentPrice.baseValue)) / (currentPrice.amount * GetBaseValue(currentPrice.baseValue)) * 100;

    const resultData: EVAndEBITAValuationResult = {
      companyFileName: companyFileName,
      timePeriod: timePeriod,
      enterpriseValue: enterpriseValue.amount * GetBaseValue(enterpriseValue.baseValue),
      annualEbita: annualCurrentYearEbita.amount * GetBaseValue(annualCurrentYearEbita.baseValue),
      evEbitaRatio: evEbitaRatio,
      growthRate: growthRate,
      avgWeightedGrowthRate: avgWeightedGrowthRate,
      forecastEbita: forecastEbita,
      forecastEV: forecastEV,
      outStandingShares: outStandingShares.amount * GetBaseValue(outStandingShares.baseValue),
      currentPrice: currentPrice.amount * GetBaseValue(currentPrice.baseValue),
      forecastPrice: forecastPrice,
      deltaPricePercentage: deltaPricePercentage,
      expectedSellingPrice: forecastPrice * 0.9, // 10 % less than forecastPrice
      potentialMaxGain: potentialMaxGain,
      marketCap: companyData.summary.marketCap.amount * GetBaseValue(companyData.summary.marketCap.baseValue),
    };
    return resultData;
  });

  return result.filter((each) => each !== undefined) as EVAndEBITAValuationResult[];
}
