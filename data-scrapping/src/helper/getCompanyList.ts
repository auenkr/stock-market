import axios from "axios";
import { sendReq } from "../utils/sendReq";
import * as cheerio from "cheerio";
import { BASE_URL, COOKIE } from "../utils/constant";

/**
 * Represents the detailed information for a single company.
 */
export type CompanyDetailList = {
  /**
   * @description Name of the company.
   * @example 'Reliance Industr'
   */
  name: string;

  /**
   * @description URL to the company's detailed page on your site.
   * @example '/company/RELIANCE/consolidated/'
   */
  url: string;

  /**
   * @description Current Market Price in Rupees.
   * @example 1488.50
   */
  cmp: number;

  /**
   * @description Price to Earnings ratio.
   * @example 26.28
   */
  pe: number;

  /**
   * @description Market Capitalization in Rupees Crores.
   * @example 2014308.00
   */
  marketCap: number;

  /**
   * @description Dividend Yield percentage.
   * @example 0.37
   */
  divYld: number;

  /**
   * @description Net Profit for the latest quarter in Rupees Crores.
   * @example 22092.00
   */
  npQtr: number;

  /**
   * @description Quarterly Profit Variation percentage.
   * @example 9.67
   */
  qtrProfitVar: number;

  /**
   * @description Sales for the latest quarter in Rupees Crores.
   * @example 254623.00
   */
  salesQtr: number;

  /**
   * @description Quarterly Sales Variation percentage.
   * @example 9.97
   */
  qtrSalesVar: number;

  /**
   * @description Return on Capital Employed percentage.
   * @example 9.69
   */
  roce: number;

  /**
   * @description Skip the company.
   * @example true
   */
  skip: boolean;
};

/**
 * A utility function to safely parse a string into a floating-point number.
 * Returns 0 if parsing fails.
 * @param value The string to parse.
 * @returns The parsed number or 0.
 */
const safeParseFloat = (value: string): number => {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
};

/**
 *
 * @param limit The number of companies to fetch per page.
 * @param pageNo The page number to retrieve.
 * @returns A promise that resolves to an array of CompanyDetail objects.
 */
export async function getCompanyList(
  limit: number = 50,
  pageNo: number = 1
): Promise<CompanyDetailList[]> {
  const url = `${BASE_URL}/screens/357649/all-listed-companies/?limit=${limit}&page=${pageNo}`;

  // These headers are important to mimic a real browser request.
  const headers = {
    cookie: COOKIE,
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  };

  try {
    const response = await sendReq(() => axios.get(url, { headers }));
    const html = response.data;
    const $ = cheerio.load(html);

    const companies: CompanyDetailList[] = [];
    // Screener may omit the data attribute depending on the response variant.
    const tableRows = $(
      "table.data-table tr[data-row-company-id], table.data-table tbody tr"
    );

    tableRows.each((index, element) => {
      const columns = $(element).find("td");

      if (columns.length >= 11) {
        const company: CompanyDetailList = {
          name: $(columns[1]).find("a").text().trim(),
          url: $(columns[1]).find("a").attr("href") || "",
          cmp: safeParseFloat($(columns[2]).text()),
          pe: safeParseFloat($(columns[3]).text()),
          marketCap: safeParseFloat($(columns[4]).text()),
          divYld: safeParseFloat($(columns[5]).text()),
          npQtr: safeParseFloat($(columns[6]).text()),
          qtrProfitVar: safeParseFloat($(columns[7]).text()),
          salesQtr: safeParseFloat($(columns[8]).text()),
          qtrSalesVar: safeParseFloat($(columns[9]).text()),
          roce: safeParseFloat($(columns[10]).text()),
          skip: false,
        };
        companies.push(company);
      }
    });
    if (companies.length === 0) {
      const isLoginPage = /login|register/i.test($("title").text()) ||
        $("form[action*='login']").length > 0;
      throw new Error(
        isLoginPage
          ? "Screener returned a login page. Set a valid COOKIE in data-scrapping/.env."
          : "Screener returned no company rows."
      );
    }

    return companies;
  } catch (error) {
    throw error;
  }
}
