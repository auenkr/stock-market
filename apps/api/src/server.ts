import { Hono } from "hono";
import axios from "axios";
import { BASE_URL } from "@stock-market/common/config";
import { COMPANY_PAGE_SIZE, HomePageData } from "./config.js";
import { GetCompanyData } from "@stock-market/scraper/helper/getCompanyData";
import { getCompanyList } from "@stock-market/scraper/helper/getCompanyList";
import { ListUpcommingIpo } from "@stock-market/scraper/helper/getUpcommingIPO";
import { sendReq } from "@stock-market/scraper/utils/sendReq";

const companyDataCache = new Map<string, Awaited<ReturnType<typeof GetCompanyData>>>();

const app = new Hono();

app.get("/", (c) => {
  return c.html(HomePageData);
});

app.get("/api/list-of-company", async (c) => {
  const pageParam = c.req.query("page") ?? "1";
  const page = Number(pageParam);

  if (!Number.isInteger(page) || page < 1) {
    return c.json({ error: "page must be a positive integer" }, 400);
  }

  const companies = await getCompanyList(COMPANY_PAGE_SIZE, page);

  return c.json({
    page,
    limit: COMPANY_PAGE_SIZE,
    companies,
  });
});

app.get("/api/list-of-ipo", async (c) => {
  try {
    const ipos = await ListUpcommingIpo();
    return c.json({ ipos });
  } catch {
    return c.json({ error: "Could not scrape IPO data" }, 500);
  }
});

app.get("/api/company-search", async (c) => {
  const query = c.req.query("q")?.trim();
  if (!query) {
    return c.json({ error: "q parameter is required" }, 400);
  }

  try {
    const response = await sendReq(() =>
      axios.get(`${BASE_URL}/api/company/search/`, {
        params: { q: query },
      }),
    );

    return c.json(response.data);
  } catch {
    return c.json({ error: "Could not search companies" }, 500);
  }
});

// This takes around 20 sec to run
app.get("/api/company-data", async (c) => {
  try {
    const endpoint = c.req.query("endpoint") || "";
    if (endpoint === "") {
      return c.json({ error: "endpoint parameter is required" }, 400);
    }

    const cachedCompanyData = companyDataCache.get(endpoint);
    if (cachedCompanyData) {
      return c.json({ companyData: cachedCompanyData });
    }

    const companyData = await GetCompanyData(endpoint);
    companyDataCache.set(endpoint, companyData);

    return c.json({ companyData });
  } catch (error) {
    return c.json({ error: "Could not scrape company data" }, 500);
  }
});

export default app;
