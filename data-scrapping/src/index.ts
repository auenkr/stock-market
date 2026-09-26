import { writeFileSync } from "node:fs";
import { upcomingIpoFile } from "./utils/constant";
import { ListUpcommingIpo } from "./helper/getUpcommingIPO";

// --- Example Usage ---
async function main() {
  const upcomingIpos = await ListUpcommingIpo();
  // writeFileSync(upcomingIpoFile, JSON.stringify(upcomingIpos, null, 2));
  // Get All company data
  // await getAllCompanyData();
  console.log(`Successfully fetched upcoming IPO data.`);
}

main();
