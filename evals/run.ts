// npm run eval                    replay recorded search results (needs ANTHROPIC_API_KEY)
// npm run eval:record             re-record cassettes with the real search provider
// flags: --case E1  --variant ours|nomemory|naive  --live --provider tavily|exa  --out name
import "dotenv/config";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, type AgentResult, type ModelClient } from "../src/agent/loop.js";
import { createApp } from "../src/app.js";
import { buildBrief } from "../src/context/brief.js";
import { nowLine, resolveTz } from "../src/context/clock.js";
import { Memory } from "../src/context/memory.js";
import { withCassette } from "../src/search/cassette.js";
import { createProvider } from "../src/search/provider.js";
import type { SearchProvider } from "../src/search/types.js";
import type { HistoryMessage } from "../src/types.js";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const mode = args.includes("--record") ? "record" : args.includes("--live") ? "live" : "replay";
const variant = (opt("variant") ?? "ours") as "ours" | "nomemory" | "naive";
const providerName = opt("provider") ?? "tavily";
const only = opt("case");

interface Check { type: string; [k: string]: any }
interface Case {
  id: string;
  kind?: "agent" | "brief" | "grounding" | "first-status";
  synthetic?: boolean; // hand-written cassette: never re-recorded, never run live
  history?: HistoryMessage[];
  seed_user_id?: string;
  user_id?: string;
  before?: string[]; // earlier messages in the same chat, run first
  client_time: string;
  tz: string;
  message: string;
  cassette?: string;
  checks: Check[];
}

const NAIVE_SYSTEM = "You are a helpful assistant. You have a web_search tool. Use it when you need to answer the question.";
const VERDICT = /\b(changed|unchanged as checked|couldn't verify|could not verify)\b/i;
const words = (s: string) => s.trim().split(/\s+/).length;

// Sonnet 5.5 list prices, USD per million tokens. Cache writes are 1.25x input.
const modelCost = (u: AgentResult["usage"]) => (u.input * 2 + u.cacheWrite * 2.5 + u.cacheRead * 0.1 + u.output * 10) / 1e6;

interface Ctx { answer: string; brief: string; result?: AgentResult; firstStatusMs?: number }

function check(c: Check, x: Ctx): string | null {
  const calls = x.result?.calls.map((k) => JSON.stringify(k.input).toLowerCase()) ?? [];
  const searches = x.result?.toolCalls ?? 0;
  const re = (p: string) => new RegExp(p, "i");
  switch (c.type) {
    case "brief_contains": return x.brief.includes(c.text) ? null : `brief lacks ${JSON.stringify(c.text)}`;
    case "brief_not_contains": return x.brief.includes(c.text) ? `brief has ${JSON.stringify(c.text)}` : null;
    case "searches": return (c.min === undefined || searches >= c.min) && (c.max === undefined || searches <= c.max) ? null : `${searches} searches, wanted ${c.min ?? 0}-${c.max ?? "any"}`;
    case "turns": return (x.result?.turns ?? 0) <= c.max ? null : `${x.result?.turns} turns, max ${c.max}`;
    case "calls_cover": { const miss = c.names.filter((n: string) => !calls.some((k: string) => k.includes(n.toLowerCase()))); return miss.length ? `no call for ${miss.join(", ")}` : null; }
    case "calls_parallel": { const byTurn = new Map<number, number>(); x.result?.calls.forEach((k) => byTurn.set(k.turn, (byTurn.get(k.turn) ?? 0) + 1)); return Math.max(0, ...byTurn.values()) >= c.min ? null : `no turn with ${c.min}+ parallel calls`; }
    case "answer_matches": return re(c.pattern).test(x.answer) ? null : `answer lacks /${c.pattern}/`;
    case "answer_not_matches": return re(c.pattern).test(x.answer) ? `answer has /${c.pattern}/` : null;
    case "words": return words(x.answer) <= c.max ? null : `${words(x.answer)} words, max ${c.max}`;
    case "verdict_each": { const miss = c.names.filter((n: string) => !x.answer.split("\n").some((l) => l.toLowerCase().includes(n.toLowerCase()) && VERDICT.test(l))); return miss.length ? `no verdict line for ${miss.join(", ")}` : null; }
    case "as_of": return /^As of \d{4}-\d\d-\d\d \d\d:\d\d/m.test(x.answer) ? null : "no As-of line";
    case "checked_line": return /^\**Checked:/im.test(x.answer) ? null : "no Checked line";
    // A page read live today has a date too: when we read it.
    case "sources": { const s = x.result?.sources ?? []; const dated = s.filter((r) => r.published || r.crawled).length; return s.length >= (c.min ?? 0) && dated >= (c.dated_min ?? 0) ? null : `${s.length} sources, ${dated} dated`; }
    case "capped": return x.result?.capped === c.value ? null : `capped=${x.result?.capped}`;
    case "grounding": return (x.result?.grounding.length ?? 0) <= c.max ? null : `${x.result?.grounding.length} grounding notes`;
    case "first_status_ms": return (x.firstStatusMs ?? 1e9) < c.max ? null : `first status after ${x.firstStatusMs} ms`;
    default: throw new Error(`unknown check ${c.type}`);
  }
}

const BRIEF_ONLY = (t: string) => t.startsWith("brief_");

// E13: a scripted model that cites a missing id and an invented price.
async function stubbedGrounding(): Promise<Ctx> {
  const provider: SearchProvider = { name: "stub", search: async () => [{ title: "Pricing", url: "https://x.com/p", published: null, crawled: null, text: "Pro costs $99 per seat." }], read: async () => { throw new Error("unused"); } };
  const script = [
    { content: [{ type: "tool_use", id: "t1", name: "web_search", input: { query: "pricing" } }], stop_reason: "tool_use" },
    { content: [{ type: "text", text: "Pro costs $42 per seat [R1]. See also [R9]." }], stop_reason: "end_turn" },
  ];
  let n = 0;
  const model = { stream: () => { const t = script[n++]; return { on: () => {}, finalMessage: async () => ({ ...t, usage: { input_tokens: 0, output_tokens: 0 } }) }; } } as unknown as ModelClient;
  const result = await runAgent({ message: "price?", brief: "", search: provider, model });
  return { answer: result.answer, brief: "", result };
}

// E17: with a slow agent, how long until the first status event?
async function firstStatus(): Promise<Ctx> {
  const slow = (async () => { await new Promise((r) => setTimeout(r, 800)); throw new Error("not needed"); }) as never;
  const app = createApp({ memory: new Memory(), run: slow, search: () => ({}) as SearchProvider });
  const t0 = Date.now();
  const res = await app.request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
  const reader = res.body!.getReader();
  await reader.read();
  const firstStatusMs = Date.now() - t0;
  await reader.cancel();
  return { answer: "", brief: "", firstStatusMs };
}

async function runAgentCase(c: Case) {
  const userId = c.user_id ?? "eval";
  const now = new Date(c.client_time);
  const tz = resolveTz(c.tz);
  const memory = new Memory();
  if (variant === "ours" && c.history) memory.seed(c.seed_user_id ?? userId, "earlier", c.history, c.client_time, tz);

  const file = join(dir("./cassettes/"), `${c.cassette ?? "_none"}.json`);
  const real = !c.synthetic && mode !== "replay" ? createProvider(process.env, providerName) : undefined;
  const provider = real && mode === "live" ? real : withCassette(file, c.synthetic || mode === "replay" ? "replay" : "record", real);

  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let last!: AgentResult, brief = "";
  for (const message of [...(c.before ?? []), c.message]) {
    brief = variant === "naive" ? "" : buildBrief({ memory: variant === "ours" ? memory : new Memory(), userId, message, now, tz });
    // The running conversation is not "memory": every variant gets it.
    const history = memory.session(userId, "chat").flatMap((t) => [{ role: "user" as const, content: t.userMsg }, { role: "assistant" as const, content: t.assistantMsg }]);
    last = await runAgent({
      message, brief, history, search: provider,
      asOf: nowLine(now, tz),
      ...(variant === "naive" && { system: NAIVE_SYSTEM, ground: false }),
    });
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += last.usage[k];
    memory.save({ userId, sessionId: "chat", userMsg: message, assistantMsg: last.answer, at: now.toISOString(), tz, sources: [] });
  }
  return { ctx: { answer: last.answer, brief, result: last } as Ctx, usage: total };
}

const casesDir = dir("./cases/");
const cases: Case[] = readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(casesDir, f), "utf8")));

const rows: any[] = [];
for (const c of cases.filter((c) => !only || c.id.startsWith(only))) {
  const kind = c.kind ?? "agent";
  const codeOnly = kind !== "agent";
  if (mode !== "replay" && (c.synthetic || codeOnly)) continue; // live and record runs only touch real-provider cases
  if (codeOnly && variant !== "ours") { rows.push({ id: c.id, na: true }); continue; }

  const t0 = Date.now();
  let ctx: Ctx, usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  try {
    if (kind === "brief") {
      ctx = { answer: "", brief: buildBrief({ memory: new Memory(), userId: "eval", message: c.message, now: new Date(c.client_time), tz: resolveTz(c.tz) }) };
    } else if (kind === "grounding") ctx = await stubbedGrounding();
    else if (kind === "first-status") ctx = await firstStatus();
    else ({ ctx, usage } = await runAgentCase(c));
  } catch (e) {
    rows.push({ id: c.id, pass: false, failed: [`error: ${e instanceof Error ? e.message : e}`], ms: Date.now() - t0 });
    continue;
  }
  const failed = c.checks.filter((k) => !(variant !== "ours" && BRIEF_ONLY(k.type))).map((k) => check(k, ctx)).filter((m): m is string => !!m);
  const r = ctx.result;
  const searchResults = (r?.results ?? []).filter((x) => !x.crawled);
  rows.push({
    id: c.id, pass: failed.length === 0, failed,
    searches: r?.toolCalls ?? 0, reads: r?.calls.filter((k) => (k.input as any)?.url).length ?? 0, turns: r?.turns ?? 0,
    ms: kind === "agent" ? (r?.ms ?? 0) : Date.now() - t0,
    cost: modelCost(usage), dated: searchResults.length ? searchResults.filter((x) => x.published).length / searchResults.length : null,
    answer: ctx.answer,
  });
}

const pad = (s: unknown, n: number) => String(s).padEnd(n);
console.log(`\nvariant=${variant} mode=${mode}${mode === "live" ? ` provider=${providerName}` : ""}\n`);
console.log(pad("case", 30), pad("pass", 6), pad("search", 7), pad("turns", 6), pad("ms", 7), pad("$model", 8), "failed checks");
for (const r of rows) {
  if (r.na) console.log(pad(r.id, 30), "n/a (tests our code, not the model)");
  else console.log(pad(r.id, 30), pad(r.pass ? "PASS" : "FAIL", 6), pad(r.searches ?? "-", 7), pad(r.turns ?? "-", 6), pad(r.ms, 7), pad(r.cost === undefined ? "-" : r.cost.toFixed(3), 8), r.failed.join("; "));
}
const run = rows.filter((r) => !r.na);
const sum = (k: string) => run.reduce((n, r) => n + (r[k] ?? 0), 0);
console.log(`\n${run.filter((r) => r.pass).length}/${run.length} passed | searches ${sum("searches")} | model cost $${sum("cost").toFixed(3)} | total ${(sum("ms") / 1000).toFixed(0)} s`);

const name = opt("out") ?? `${variant}-${mode}${mode === "live" ? "-" + providerName : ""}`;
mkdirSync(dir("./results/"), { recursive: true });
writeFileSync(dir(`./results/${name}.json`), JSON.stringify({ variant, mode, provider: mode === "live" ? providerName : "recorded", rows }, null, 2));
process.exit(mode === "record" || run.every((r) => r.pass) ? 0 : 1);
