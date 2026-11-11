// Runs the agent once: npx tsx scripts/agent.ts "<message>" [--seed]
// Needs ANTHROPIC_API_KEY and TAVILY_API_KEY in .env. Memory is empty unless --seed,
// which stores a CRM shortlist conversation dated on the most recent Monday.
import "dotenv/config";
import { runAgent } from "../src/agent/loop.js";
import { buildBrief } from "../src/context/brief.js";
import { nowLine, resolveTz } from "../src/context/clock.js";
import { Memory } from "../src/context/memory.js";
import { tavily } from "../src/search/tavily.js";

const message = process.argv[2];
const seed = process.argv.includes("--seed");
if (!message) throw new Error('Usage: npx tsx scripts/agent.ts "<message>"');
if (!process.env.ANTHROPIC_API_KEY || !process.env.TAVILY_API_KEY) throw new Error("Set ANTHROPIC_API_KEY and TAVILY_API_KEY in .env");

const now = new Date();
const tz = resolveTz(process.env.TZ);
const memory = new Memory();
if (seed) {
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - (((monday.getUTCDay() + 6) % 7) || 7));
  const at = monday.toISOString().slice(0, 10) + "T05:30:00Z";
  memory.seed(
    "cli",
    "s-mon",
    [
      { role: "user", content: "We shortlisted HubSpot, Pipedrive, Zoho CRM, Salesforce and Close for a 20-person sales team. What do they cost?", at },
      { role: "assistant", content: "Per seat per month, billed annually: HubSpot Sales Hub Starter $20, Pipedrive Essential $14, Zoho CRM Standard $14, Salesforce Sales Pro $100, Close Startup $9." },
    ],
    at,
    tz,
  );
}
const brief = buildBrief({ memory, userId: "cli", message, now, tz });

const t0 = Date.now();
let firstToken = 0;
const r = await runAgent({
  message,
  brief,
  asOf: nowLine(now, tz),
  search: tavily(process.env.TAVILY_API_KEY),
  emit: (e) => {
    if (e.type === "status") console.log(`[+${Date.now() - t0}ms] ${e.text}`);
    else {
      firstToken ||= Date.now() - t0;
      process.stdout.write(e.text);
    }
  },
});

console.log("\n\nSOURCES:");
for (const s of r.sources) console.log(`  [${s.id}] ${s.title} | ${s.url} | published ${s.published ?? "unknown"}${s.crawled ? " | read live" : ""}`);
console.log(
  `\n--- searches: ${r.toolCalls} | model turns: ${r.turns} | capped: ${r.capped} | first token: ${firstToken} ms | total: ${r.ms} ms`,
);
console.log(`--- tokens in/out: ${r.usage.input}/${r.usage.output} | cache read/write: ${r.usage.cacheRead}/${r.usage.cacheWrite}`);
