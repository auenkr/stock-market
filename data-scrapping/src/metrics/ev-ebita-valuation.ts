import type { CompanyDataType } from "../helper/getCompanyData";
import { join } from "node:path";
import fs from "node:fs";
import { getEnterpriseValue, getAnnualEBITA, getShareOutstanding, getCompanyMonthPrice } from "./utils";
import { GetBaseValue } from "../utils/helper";

function readCompanyData(fileName: string): CompanyDataType {
    const filePath = join(__dirname, "../../gen/companyData", fileName);
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
};

export function GetEVAndEBITAValuation(companyFileName: string) : EVAndEBITAValuationResult[] {
  const companyData = readCompanyData(companyFileName);
  
  let timePeriods = companyData.profitAndLossStatements.map((each) => each.timePeriod);
  timePeriods = timePeriods.filter((each) => each !== "TTM");

  let avgWeightedGrowthRate = 0;
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
    const currentPrice = getCompanyMonthPrice(metric, timePeriod);

    const deltaPricePercentage = (forecastPrice - currentPrice.amount * GetBaseValue(currentPrice.baseValue)) / (currentPrice.amount * GetBaseValue(currentPrice.baseValue)) * 100;

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
    };
    return resultData;
  });

  return result.filter((each) => each !== undefined) as EVAndEBITAValuationResult[];
}
