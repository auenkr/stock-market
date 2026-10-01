import { writeFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { classificationName, parseMarketLinks } from "@stock-market/scraper/helper/getCompanySnapshot";
import { ScreenerProvider } from "../src/screener-provider.js";

const source = new ScreenerProvider({ baseUrl: process.env.BASE_URL, cookie: process.env.COOKIE, fetcher: async (input, init) => {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return fetch(input, init);
} });
const entries = new Map<string, { name: string; path: string }>();
const add = (links: { name: string; path: string }[]) => links.forEach(({ name, path }) => {
  if (/^\/market\/(?:IN\d+\/){1,4}$/.test(path)) entries.set(path, { name: name.replace(/\s+-\s+\d+$/, ""), path });
});
add(parseMarketLinks(await source.html("/market/")));
const macros = [...new Set([...entries.keys()].map((p) => `/market/${p.split("/")[2]}/`))];
for (const path of macros) {
  const html = await source.html(path);
  entries.set(path, { path, name: classificationName(html) }); add(parseMarketLinks(html));
}
const industries = [...entries.keys()].filter((p) => p.split("/").filter(Boolean).length === 3);
for (const path of industries) add(parseMarketLinks(await source.html(path)));
const artifact = { source: "https://www.screener.in/market/", inspectedAt: new Date().toISOString().slice(0, 10), entries: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)) };
await writeFile(new NodeURL("../src/screener-taxonomy.json", import.meta.url), JSON.stringify(artifact, null, 2) + "\n");
console.log(`Saved ${entries.size} classification names and paths; no market history downloaded.`);
