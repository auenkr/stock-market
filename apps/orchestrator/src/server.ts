import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import dotenv from "dotenv";
import {
  allCompanyDataDir,
  companyListFile,
  ORCHESTRATOR_PORT,
} from "@stock-market/common/config";
import type { CompanyDataType } from "@stock-market/scraper/helper/getCompanyData";
import type { CompanyDetailListServer } from "@stock-market/scraper/types";

dotenv.config();

async function readCompanyList() {
  const data = await readFile(companyListFile, "utf8");
  return JSON.parse(data) as CompanyDetailListServer[];
}

async function writeCompanyList(companyList: CompanyDetailListServer[]) {
  await writeFile(companyListFile, JSON.stringify(companyList, null, 2));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(
  response: ServerResponse,
  body: unknown,
  statusCode = 200,
) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;

    if (path === "/api/worker/task" && request.method === "GET") {
      const companyListData = await readCompanyList();
      const company = companyListData.find((item) => item.status === "pending");

      if (company === undefined) {
        sendJson(response, { company: null });
        return;
      }

      company.status = "running";
      await writeCompanyList(companyListData);
      sendJson(response, company);
      return;
    }

    if (path === "/api/worker/task" && request.method === "POST") {
      const body = (await readBody(request)) as CompanyDetailListServer;
      const companyListData = await readCompanyList();
      companyListData.forEach((company) => {
        if (company.name === body.name) company.status = "pending";
      });
      await writeCompanyList(companyListData);
      sendJson(response, {});
      return;
    }

    if (path === "/api/task" && request.method === "GET") {
      const companyListData = await readCompanyList();
      companyListData.forEach((company) => {
        company.status = existsSync(join(allCompanyDataDir, `${company.name}.json`))
          ? "completed"
          : "pending";
      });
      await writeCompanyList(companyListData);
      sendJson(response, { companyList: companyListData });
      return;
    }

    if (path === "/api/task" && request.method === "POST") {
      const { name, data } = (await readBody(request)) as {
        data: CompanyDataType;
        name: string;
      };

      if (data.refId === undefined || data.name === null || data.about === "") {
        sendJson(response, { error: "Ref ID is required" }, 400);
        return;
      }

      const companyListData = await readCompanyList();
      const company = companyListData.find((item) => item.name === name);
      if (company === undefined) {
        sendJson(response, { error: "Company not found" }, 400);
        return;
      }

      const filePath = join(allCompanyDataDir, `${data.name}.json`);
      if (existsSync(filePath)) {
        sendJson(response, { error: "Company data already exists" }, 400);
        return;
      }

      company.status = "completed";
      await writeFile(filePath, JSON.stringify(data, null, 2));
      await writeCompanyList(companyListData);
      console.log(data.name, "completed");
      sendJson(response, company);
      return;
    }

    sendJson(response, { error: "Not Found" }, 404);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "Internal Server Error" }, 500);
  }
});

server.listen(ORCHESTRATOR_PORT, () => {
  console.log(`Server running at http://localhost:${ORCHESTRATOR_PORT}`);
});
