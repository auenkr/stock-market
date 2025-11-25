import type { CompanyMetricDataType } from "../helper/getCompanyMetric";
import type { CompanyDataType, NumberDataType } from "../helper/getCompanyData";
import { GetBaseValue } from "../utils/helper";

export function getCompanyMonthPrice(
  metric: CompanyMetricDataType,
  timePeriod: string
): NumberDataType {
  if (metric.metric !== "Price") {
    throw new Error("only price metric allow");
  }

  const monthMap: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const parts = timePeriod.trim().split(" ");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid timePeriod format: ${timePeriod}. Expected format: "MMM YYYY" (e.g., "Sep 2022")`
    );
  }

  const monthAbbr = parts[0];
  const year = parseInt(parts[1], 10);

  if (!monthMap[monthAbbr] || isNaN(year)) {
    throw new Error(
      `Invalid timePeriod format: ${timePeriod}. Expected format: "MMM YYYY" (e.g., "Sep 2022")`
    );
  }

  const targetMonth = monthMap[monthAbbr];
  const targetYear = year;

  const matchingDates: string[] = [];
  for (const dateStr of Object.keys(metric.values)) {
    const date = new Date(dateStr);
    if (date.getMonth() === targetMonth && date.getFullYear() === targetYear) {
      matchingDates.push(dateStr);
    }
  }

  if (matchingDates.length === 0) {
    throw new Error(`No price data found for timePeriod: ${timePeriod}`);
  }

  matchingDates.sort((a, b) => {
    return new Date(b).getTime() - new Date(a).getTime();
  });

  const mostRecentDate = matchingDates[0];
  if (!mostRecentDate) {
    throw new Error(`No price data found for timePeriod: ${timePeriod}`);
  }
  const priceData = metric.values[mostRecentDate];
  if (!priceData) {
    throw new Error(`No price data found for date: ${mostRecentDate}`);
  }
  return priceData;
}

export function getEnterpriseValue(
  companyData: CompanyDataType,
  timePeriod: string
): NumberDataType {
  let enterpriseValueData: NumberDataType = {
    amount: 0,
    baseValue: "crore",
  };
  const priceMetric = companyData.metrics.filter(
    (each) => each.metric === "Price"
  )[0];
  if (!priceMetric) {
    throw new Error("Price metric not found");
  }
  const sharePrice = getCompanyMonthPrice(priceMetric, timePeriod);
  const shareOutstanding = getShareOutstanding(companyData, timePeriod);
  const marketCapData: NumberDataType = {
    amount:
      sharePrice.amount *
      GetBaseValue(sharePrice.baseValue) *
      (shareOutstanding.amount * GetBaseValue(shareOutstanding.baseValue)),
    baseValue: "one",
  };
  const totalDebt = companyData.balanceSheetStatements.filter(
    (each) => each.timePeriod === timePeriod
  )[0]?.borrowings;
  if (!totalDebt) {
    throw new Error("Total Debt not found");
  }
  const totalDebtData: NumberDataType = {
    amount: totalDebt.value.amount * GetBaseValue(totalDebt.value.baseValue),
    baseValue: "one",
  };
  const cashAndCashEquivalents = companyData.balanceSheetStatements.filter(
    (each) => each.timePeriod === timePeriod
  )[0]?.otherAssets.other["Cash Equivalents"];
  if (!cashAndCashEquivalents) {
    throw new Error("Cash and Cash Equivalents not found");
  }
  const cashAndCashEquivalentsData: NumberDataType = {
    amount:
      cashAndCashEquivalents.amount *
      GetBaseValue(cashAndCashEquivalents.baseValue),
    baseValue: "one",
  };
  const enterpriseValue =
    marketCapData.amount * GetBaseValue(marketCapData.baseValue) +
    totalDebtData.amount * GetBaseValue(totalDebtData.baseValue) -
    cashAndCashEquivalentsData.amount *
      GetBaseValue(cashAndCashEquivalentsData.baseValue);
  enterpriseValueData.amount = enterpriseValue;
  enterpriseValueData.baseValue = "one";
  return enterpriseValueData;
}

export function getQuarterlyEBITA(
  companyData: CompanyDataType,
  timePeriod: string
): NumberDataType {
  let ebitaData: NumberDataType = {
    amount: 0,
    baseValue: "none",
  };
  const operatingProfit = companyData.quarterlyResultStatements.filter(
    (each) => each.timePeriod === timePeriod
  )[0]?.operatingProfit;
  if (!operatingProfit) {
    throw new Error("Operating Profit not found");
  }
  const depreciation = companyData.quarterlyResultStatements.filter(
    (each) => each.timePeriod === timePeriod
  )[0]?.depreciation;
  if (!depreciation) {
    throw new Error("Depreciation not found");
  }
  const ebita =
    operatingProfit.amount * GetBaseValue(operatingProfit.baseValue) -
    depreciation.amount * GetBaseValue(depreciation.baseValue);
  ebitaData.amount = ebita;
  ebitaData.baseValue = "one";
  return ebitaData;
}

export function getAnnualEBITA(
  companyData: CompanyDataType,
  timePeriod: string
): NumberDataType {
  let ebitaData: NumberDataType = {
    amount: 0,
    baseValue: "none",
  };
  const operatingProfit = companyData.profitAndLossStatements.filter(
    (each) => each.timePeriod === timePeriod
  )[0]?.operatingProfit;
  if (!operatingProfit) {
    throw new Error("Operating Profit not found");
  }
  const depreciation = companyData.profitAndLossStatements.filter(
    (each) => each.timePeriod === timePeriod
  )[0]?.depreciation;
  if (!depreciation) {
    throw new Error("Depreciation not found");
  }
  const ebita =
    operatingProfit.amount * GetBaseValue(operatingProfit.baseValue) -
    depreciation.amount * GetBaseValue(depreciation.baseValue);
  ebitaData.amount = ebita;
  ebitaData.baseValue = "one";
  return ebitaData;
}

export function getShareOutstanding(
  companyData: CompanyDataType,
  timePeriod: string
): NumberDataType {
  let shareOutstandingData: NumberDataType = {
    amount: 0,
    baseValue: "none",
  };
  const equityCapital = companyData.balanceSheetStatements.filter(
    (each) => each.timePeriod === timePeriod
  )[0]?.equityCapital;
  if (!equityCapital) {
    throw new Error("Equity capital not found");
  }
  const faceValue = companyData.summary.faceValue;
  shareOutstandingData.amount =
    (equityCapital.amount * GetBaseValue(equityCapital.baseValue)) /
    (faceValue.amount * GetBaseValue(faceValue.baseValue));
  shareOutstandingData.baseValue = "one";
  return shareOutstandingData;
}
