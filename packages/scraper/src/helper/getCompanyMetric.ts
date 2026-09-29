import { BASE_URL } from "@stock-market/common/config";
import axios from "axios";
import { sendReq } from "../utils/sendReq.js";
import { parseNumberData, type NumberDataType } from "./getCompanyData.js";

type CompanyPriceDataTypeResponse = {
  datasets: {
    metric: string;
    label: string;
    values: [string, string][]; // [date(YYYY-MM-DD), price(need to parse to number)]
    meta: {
      is_weekly: boolean;
    };
  }[];
};

export type CompanyMetricDataType = {
    metric: string;
    label: string;
    values: Record<string, NumberDataType>; // [date(YYYY-MM-DD), price(need to parse to number)]
    meta: {
      is_weekly: boolean;
    };
};

export async function getCompanyMetrics(companyRefId: string) : Promise<CompanyMetricDataType[]> {
  const response = await sendReq(() => axios.get(`${BASE_URL}/api/company/${companyRefId}/chart/?q=Price&days=10000&consolidated=true`));
  const data = response.data as unknown as CompanyPriceDataTypeResponse;
 
  // Converting price to number
  const result : CompanyMetricDataType[] = data.datasets.map((dataset) => {
    return {
        metric: dataset.metric,
        label: dataset.label,
        values: Object.fromEntries(
          dataset.values.map((value) => [
            value[0],
            parseNumberData(value[1], "one")
          ])
        ) as Record<string, NumberDataType>,
        meta: dataset.meta,
    };
  });
  return result;
}
