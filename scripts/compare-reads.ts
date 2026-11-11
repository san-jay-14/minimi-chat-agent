// Live page reads on the pricing pages the evals touch, per provider.
// Needs TAVILY_API_KEY and EXA_API_KEY:  npx tsx scripts/compare-reads.ts
import "dotenv/config";
import { createProvider } from "../src/search/provider.js";

const urls = [
  "https://www.hubspot.com/pricing/sales",
  "https://www.pipedrive.com/en/pricing",
  "https://www.zoho.com/crm/pricing/",
  "https://www.salesforce.com/sales/pricing/",
  "https://www.close.com/pricing",
  "https://neon.com/pricing",
  "https://supabase.com/pricing",
  "https://render.com/pricing",
];

for (const name of ["tavily", "exa"]) {
  const p = createProvider(process.env, name);
  let ok = 0, priced = 0, ms = 0;
  console.log(`\n${name}`);
  for (const url of urls) {
    const t0 = Date.now();
    try {
      const r = await p.read(url, AbortSignal.timeout(30_000));
      const hasPrice = /[$€£₹]\s?\d/.test(r.text);
      ok++;
      priced += hasPrice ? 1 : 0;
      console.log(`  ok    ${String(Date.now() - t0).padStart(5)} ms  ${String(r.text.length).padStart(6)} chars  prices:${hasPrice ? "yes" : "NO "}  ${url}`);
    } catch (e) {
      console.log(`  FAIL  ${String(Date.now() - t0).padStart(5)} ms  ${(e as Error).message.slice(0, 70)}  ${url}`);
    }
    ms += Date.now() - t0;
  }
  console.log(`  => read ok ${ok}/${urls.length}, with prices ${priced}/${urls.length}, mean ${Math.round(ms / urls.length)} ms`);
}
