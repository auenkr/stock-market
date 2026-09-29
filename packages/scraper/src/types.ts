import type { CompanyDetailList } from "./helper/getCompanyList.js";

export type CompanyDetailListServer = CompanyDetailList & {
  status?: "pending" | "completed" | "running";
};
