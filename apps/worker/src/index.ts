import { ORCHESTRATOR_PORT } from "@stock-market/common/config";
import { errorDetails, log } from "@stock-market/common/logger";
import { GetCompanyData } from "@stock-market/scraper/helper/getCompanyData";
import type { CompanyDetailListServer } from "@stock-market/scraper/types";

const orchestratorUrl = process.env.ORCHESTRATOR_URL || `http://localhost:${ORCHESTRATOR_PORT}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${orchestratorUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    log("error", "worker.orchestrator.failed", { path, status: response.status, requestId: response.headers.get("X-Request-ID") });
    throw new Error(`Orchestrator returned HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function workerTask() {
  let companyName: string | undefined;
  try {
    const company = await request<CompanyDetailListServer | { company: null }>("/api/worker/task");
    if ("company" in company) {
      log("info", "worker.idle", { retryInMs: 100_000 });
      await sleep(100_000);
      return;
    }
    companyName = company.name;
    log("info", "worker.task.started", { company: companyName });
    const data = await GetCompanyData(company.url);
    const updated = await request<CompanyDetailListServer>("/api/task", { data, name: companyName });
    if (updated.status !== "completed") throw new Error("Task was not marked completed");
    log("info", "worker.task.completed", { company: companyName });
  } catch (error) {
    log("error", "worker.task.failed", { company: companyName, error: errorDetails(error), retryInMs: 1000 });
    // Startup/connection failures have no task to reset. A reset failure must
    // never terminate polling or hide the original failure.
    if (companyName) {
      const skip = (error as { response?: { status?: number } }).response?.status === 404;
      if (skip) log("warn", "worker.task.skipped", { company: companyName, reason: "Source company no longer exists" });
      try { await request("/api/worker/task", { name: companyName, skip }); }
      catch (resetError) { log("error", "worker.task.reset.failed", { company: companyName, error: errorDetails(resetError) }); }
    }
    await sleep(1000);
  }
}

log("info", "worker.started", { orchestratorUrl });
while (true) await workerTask();
