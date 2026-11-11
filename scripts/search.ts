// Real search + live read, then a cassette record/replay check.
// Needs TAVILY_API_KEY in .env:  npx tsx scripts/search.ts
import "dotenv/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCassette } from "../src/search/cassette.js";
import { tavily } from "../src/search/tavily.js";
import { createWebSearch } from "../src/search/tool.js";

const key = process.env.TAVILY_API_KEY;
if (!key) throw new Error("Set TAVILY_API_KEY in .env first");

const cassette = join(mkdtempSync(join(tmpdir(), "cassette-")), "demo.json");
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);

async function session(provider: ReturnType<typeof tavily> | ReturnType<typeof withCassette>) {
  const tool = createWebSearch(provider);
  const t0 = Date.now();
  const search = await tool.run({ query: "HubSpot CRM pricing change", start_date: day(-30), max_results: 5 });
  const t1 = Date.now();
  const read = await tool.run({ url: "https://www.hubspot.com/pricing/sales" });
  return { search, read, searchMs: t1 - t0, readMs: Date.now() - t1 };
}

const live = await session(withCassette(cassette, "record", tavily(key)));
console.log("=== SEARCH (last 30 days) ===\n" + live.search.text + `\n(${live.searchMs} ms)\n`);
console.log("=== LIVE READ ===\n" + live.read.text.slice(0, 1500) + `\n... (${live.readMs} ms)\n`);

const replay = await session(withCassette(cassette, "replay"));
const same = JSON.stringify(replay.search) === JSON.stringify(live.search) && JSON.stringify(replay.read) === JSON.stringify(live.read);
console.log(`cassette replay identical to live run: ${same}`);
console.log(`results with a published date: ${live.search.results.filter((r) => r.published).length}/${live.search.results.length}`);
