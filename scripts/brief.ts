// Prints the brief for a seeded conversation: npx tsx scripts/brief.ts "<message>" [tz]
import { buildBrief } from "../src/context/brief.js";
import { Memory } from "../src/context/memory.js";

const memory = new Memory();
const tz = process.argv[3] ?? "Asia/Kolkata";

memory.seed(
  "demo",
  "s-mon",
  [
    {
      role: "user",
      content: "We shortlisted HubSpot, Pipedrive, Zoho, Salesforce and Close for a 20-person sales team. Pricing?",
      at: "2026-11-09T05:32:00Z",
    },
    {
      role: "assistant",
      content: "HubSpot Starter $20/seat, Pipedrive Essential $14, Zoho Standard $14, Salesforce Pro $100, Close Startup $9.",
    },
  ],
  "2026-11-09T05:32:00Z",
  tz,
);
memory.seed(
  "demo",
  "s-tue",
  [
    { role: "user", content: "Best managed Postgres hosting?", at: "2026-11-03T08:00:00Z" },
    { role: "assistant", content: "Neon, Supabase and RDS are the usual picks; Neon has a free tier." },
  ],
  "2026-11-03T08:00:00Z",
  tz,
);

const message = process.argv[2] ?? "Has any of them changed pricing or shipped something big since Monday?";
console.log(buildBrief({ memory, userId: "demo", message, now: new Date("2026-11-11T07:28:00Z"), tz }));
