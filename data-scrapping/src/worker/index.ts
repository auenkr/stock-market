import dotenv from "dotenv";
import type { CompanyDetailListServer } from "../orchestrator/server";
import { GetCompanyData } from "../helper/getCompanyData";
dotenv.config();

const PORT = process.env.PORT ?? 3000;
const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL || `http://localhost:${PORT}`;

async function workerTask() {
  let companyName = "";
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/api/worker/task`);
    const companyData = (await response.json()) as
      | CompanyDetailListServer
      | { company: null };
    if ("company" in companyData) {
      console.log("No task found. Sleeping for 100 second...");
      await new Promise((resolve) => setTimeout(resolve, 100_000));
      return null;
    }
    companyName = companyData.name;
    console.log("Task found:", companyData.name);

    const data = await GetCompanyData(companyData.url);
    console.log("Company data fetched:", companyData.name);

    const resp = await fetch(`${ORCHESTRATOR_URL}/api/task`, {
      method: "POST",
      body: JSON.stringify({
        data,
        name: companyData.name,
      }),
    });
    const updatedCompanyData = (await resp.json()) as CompanyDetailListServer;
    console.log(updatedCompanyData);

    if (
      updatedCompanyData?.status &&
      updatedCompanyData.status === "completed"
    ) {
      console.log("Task completed:", companyData.name);
      return null;
    } else {
      console.log("Task failed:", companyData.name);
      throw new Error("Task failed");
    }
  } catch (error) {
    const resp = await fetch(`${ORCHESTRATOR_URL}/api/worker/task`, {
      method: "POST",
      body: JSON.stringify({ name: companyName }),
    });
    const updatedCompanyData = (await resp.json()) as CompanyDetailListServer;
    if (updatedCompanyData?.status && updatedCompanyData.status === "pending") {
      console.log("Task failed:", companyName);
      throw new Error("Task failed");
    }
    console.error("Error getting task:", error);
    console.log("Retrying in 1 second...");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return null;
  }
}

async function main() {
  try {
    while (true) {
      await workerTask();
    }
  } catch (error) {
    console.error("Error getting task:", error);
    console.log("Retrying in 1 second...");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    main();
  }
}

main();
