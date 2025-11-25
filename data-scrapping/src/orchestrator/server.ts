import dotenv from "dotenv";
import { join } from "node:path";
import { allCompanyDataDir, companyListFile } from "../utils/constant";
import type { CompanyDetailList } from "../helper/getCompanyList";
import { existsSync } from "node:fs";
import type { CompanyDataType } from "../helper/getCompanyData";
dotenv.config();

const PORT = process.env.PORT || 3000;

export type CompanyDetailListServer = CompanyDetailList & {
  status?: "pending" | "completed" | "running";
};

const server = Bun.serve({
  port: PORT,
  // `routes` requires Bun v1.2.3+
  routes: {
    // Static routes
    "/api/worker/task": {
      GET: async (req) => {
        const companyList = await Bun.file(companyListFile);
        const companyListData =
          (await companyList.json()) as CompanyDetailListServer[];

        const pendingCompanies = companyListData.filter(
          (company) => company.status === "pending"
        );
        if (
          pendingCompanies.length === 0 ||
          pendingCompanies[0] === undefined
        ) {
          return Response.json({ company: null });
        }

        const company = pendingCompanies[0];
        companyListData.forEach((each) => {
          if (each.name === company.name) {
            each.status = "running";
          }
        });

        await Bun.write(
          companyListFile,
          JSON.stringify(companyListData, null, 2)
        );
        return Response.json({ ...company });
      },
      // Failed Task
      POST: async (req) => {
        const body = (await req.json()) as CompanyDetailListServer;
        const data = await Bun.file(companyListFile);
        const companyListData =
          (await data.json()) as CompanyDetailListServer[];

        let company: CompanyDetailListServer | undefined;
        companyListData.forEach((eachCompany) => {
          if (eachCompany.name === body.name) {
            eachCompany.status = "pending";
          }
        });
        await Bun.write(
          companyListFile,
          JSON.stringify(companyListData, null, 2)
        );

        return Response.json({ ...company });
      },
    },

    // Per-HTTP method handlers
    "/api/task": {
      GET: async () => {
        const companyList = await Bun.file(companyListFile);
        const companyListData =
          (await companyList.json()) as CompanyDetailListServer[];

        companyListData.forEach((eachCompany) => {
          if (existsSync(join(allCompanyDataDir, eachCompany.name + ".json"))) {
            eachCompany.status = "completed";
          } else {
            eachCompany.status = "pending";
          }
        });

        await Bun.write(
          companyListFile,
          JSON.stringify(companyListData, null, 2)
        );
        return Response.json({ companyList: companyListData });
      },
      POST: async (req) => {
        const {name, data} = (await req.json()) as {
          data: CompanyDataType;
          name: string;
        };

        if (
          data.refId === undefined ||
          data.name === null ||
          data.about === ""
        ) {
          return Response.json(
            { error: "Ref ID is required" },
            { status: 400 }
          );
        }

        // Checking if the company is exists in the list
        const companyList = await Bun.file(companyListFile);
        const companyListData =
          (await companyList.json()) as CompanyDetailListServer[];

        let company: CompanyDetailListServer | undefined;
        companyListData.forEach((eachCompany) => {
          if (eachCompany.name === name) {
            eachCompany.status = "completed";
            company = eachCompany;
          }
        });

        if (company === undefined) {
          return Response.json({ error: "Company not found" }, { status: 400 });
        }

        // Saving the data to the file
        const fileDir = join(allCompanyDataDir, data.name + ".json");
        if (existsSync(fileDir)) {
          return Response.json(
            { error: "Company data already exists" },
            { status: 400 }
          );
        }

        // Saving the data to the file
        await Bun.write(fileDir, JSON.stringify(data, null, 2));

        // Updating the company list
        await Bun.write(
          companyListFile,
          JSON.stringify(companyListData, null, 2)
        );
        console.log(data.name, "completed");

        return Response.json({ ...company });
      },
    },
  },

  // (optional) fallback for unmatched routes:
  // Required if Bun's version < 1.2.3
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}`);
