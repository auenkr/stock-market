import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorDetails, log } from "@stock-market/common/logger";
import {
  allCompanyDataDir,
  companyListFile,
  ORCHESTRATOR_PORT,
} from "@stock-market/common/config";
import type { CompanyDataType } from "@stock-market/scraper/helper/getCompanyData";
import type { CompanyDetailListServer } from "@stock-market/scraper/types";

await mkdir(allCompanyDataDir, { recursive: true });
try { await writeFile(companyListFile, "[]", { flag: "wx" }); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }

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
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  response.setHeader("X-Request-ID", requestId);
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  response.on("finish", () => log(response.statusCode >= 500 ? "error" : "info", "orchestrator.request.completed", {
    requestId, method: request.method, path, status: response.statusCode, durationMs: Date.now() - startedAt,
  }));
  try {
    if (path === "/health" && request.method === "GET") {
      sendJson(response, { status: "ok", service: "stock-market-orchestrator" });
      return;
    }

    if (path === "/api/worker/task" && request.method === "GET") {
      const companyListData = await readCompanyList();
      const company = companyListData.find((item) => item.status === "pending" && !item.skip);

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
        if (company.name === body.name) {
          company.status = "pending";
          if (body.skip) company.skip = true;
        }
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
    log("error", "orchestrator.request.failed", { requestId, method: request.method, path, error: errorDetails(error) });
    sendJson(response, { error: "Internal Server Error" }, 500);
  }
});

server.listen(ORCHESTRATOR_PORT, () => {
  log("info", "orchestrator.started", { url: `http://localhost:${ORCHESTRATOR_PORT}`, companyListFile });
});
server.on("error", (error) => {
  log("error", "orchestrator.start.failed", { port: ORCHESTRATOR_PORT, error: errorDetails(error) });
  process.exitCode = 1;
});
