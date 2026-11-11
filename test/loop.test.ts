import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { MAX_SEARCHES, MAX_TURNS, runAgent, type AgentEvent, type ModelClient } from "../src/agent/loop.js";
import type { RawResult, SearchProvider } from "../src/search/types.js";

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 };
const text = (t: string): Anthropic.ContentBlock => ({ type: "text", text: t, citations: null }) as Anthropic.ContentBlock;
const call = (id: string, input: object): Anthropic.ContentBlock =>
  ({ type: "tool_use", id, name: "web_search", input }) as Anthropic.ContentBlock;

type Scripted = { content: Anthropic.ContentBlock[]; stop_reason: Anthropic.StopReason };
const answer = (t: string): Scripted => ({ content: [text(t)], stop_reason: "end_turn" });
const tools = (...blocks: Anthropic.ContentBlock[]): Scripted => ({ content: blocks, stop_reason: "tool_use" });

// Replays scripted turns in order and records every request. Past the script it
// keeps asking for one more search, like a model that never stops.
function scripted(turns: Scripted[]) {
  const requests: Anthropic.MessageStreamParams[] = [];
  const snapshots: Anthropic.MessageParam[][] = [];
  const model: ModelClient = {
    stream(params) {
      requests.push(params);
      snapshots.push(structuredClone(params.messages));
      const turn = turns[requests.length - 1] ?? tools(call(`more${requests.length}`, { query: "again" }));
      let cb: (d: string) => void = () => {};
      return {
        on: (_e, f) => void (cb = f),
        async finalMessage() {
          for (const b of turn.content) if (b.type === "text") cb(b.text);
          return { ...turn, usage } as unknown as Anthropic.Message;
        },
      };
    },
  };
  return { model, requests, snapshots };
}

function provider() {
  let live = 0;
  const p = {
    name: "fake",
    calls: [] as string[],
    maxParallel: 0,
    async search(q: { query: string }) {
      p.calls.push(q.query);
      p.maxParallel = Math.max(p.maxParallel, ++live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return [{ title: q.query, url: `https://x.com/${encodeURIComponent(q.query)}`, published: "2026-11-01", crawled: null, text: "Pro $99" }] as RawResult[];
    },
    async read(url: string) {
      p.calls.push(url);
      return { title: "Page", url, published: null, crawled: "2026-11-11T07:00:00Z", text: "Pricing $20" } as RawResult;
    },
  };
  return p satisfies SearchProvider & object;
}

const base = { message: "q", brief: "NOW: 2026-11-11 12:58 (UTC), Wednesday\nMEMORY MATCHES: none" };

describe("runAgent", () => {
  it("answers chit-chat with no tool call, streaming tokens", async () => {
    const { model } = scripted([answer("Hello!")]);
    const events: AgentEvent[] = [];
    const r = await runAgent({ ...base, search: provider(), model, emit: (e) => events.push(e) });
    expect(r).toMatchObject({ answer: "Hello!", toolCalls: 0, turns: 1, capped: false });
    expect(events).toEqual([{ type: "token", text: "Hello!" }]);
  });

  it("runs parallel tool calls together and returns all results in one user message", async () => {
    const p = provider();
    const { model, snapshots } = scripted([
      tools(call("a", { query: "HubSpot pricing" }), call("b", { query: "Pipedrive pricing" }), call("c", { url: "https://zoho.com/pricing" })),
      answer("Done [R1]"),
    ]);
    const events: AgentEvent[] = [];
    const r = await runAgent({ ...base, search: p, model, emit: (e) => events.push(e) });

    expect(p.maxParallel).toBeGreaterThan(1);
    expect(r).toMatchObject({ toolCalls: 3, turns: 2 });
    expect(r.results.map((x) => x.id).sort()).toEqual(["R1", "R2", "R3"]);

    const second = snapshots[1];
    const toolResults = second[2].content as Anthropic.ToolResultBlockParam[];
    expect(second[1].role).toBe("assistant");
    expect(toolResults.map((t) => t.tool_use_id)).toEqual(["a", "b", "c"]);

    expect(events.filter((e) => e.type === "status").map((e) => (e as { text: string }).text)).toEqual([
      "Searching: HubSpot pricing",
      "Searching: Pipedrive pricing",
      "Reading: zoho.com",
    ]);
  });

  it("sends the brief and message, the cached system prompt, tools, effort, and no sampling or thinking params", async () => {
    const { model, requests } = scripted([answer("ok")]);
    await runAgent({ ...base, search: provider(), model, history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "reply" }] });
    const req = requests[0] as unknown as Record<string, any>;
    expect(req.messages).toHaveLength(3);
    expect(req.messages[0]).toEqual({ role: "user", content: "earlier" });
    expect(req.messages[2].content).toContain("NOW: 2026-11-11");
    expect(req.messages[2].content).toContain("USER MESSAGE:\nq");
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.tools.map((t: { name: string }) => t.name)).toEqual(["web_search"]);
    expect(req.tool_choice).toEqual({ type: "auto" });
    expect(req.output_config.effort).toBe("medium");
    for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(req).not.toHaveProperty(k);
  });

  it("sums token usage, including cache reads and writes", async () => {
    const { model } = scripted([tools(call("a", { query: "x" })), answer("ok")]);
    const r = await runAgent({ ...base, search: provider(), model });
    expect(r.usage).toEqual({ input: 20, output: 10, cacheRead: 14, cacheWrite: 6 });
  });

  it("stops at the search cap: runs 10, errors the rest, then a final turn with tools off", async () => {
    const p = provider();
    const twelve = Array.from({ length: 12 }, (_, i) => call(`t${i}`, { query: `q${i}` }));
    const { model, requests, snapshots } = scripted([tools(...twelve), answer("Partial answer, limit reached.")]);
    const r = await runAgent({ ...base, search: p, model });

    expect(p.calls).toHaveLength(MAX_SEARCHES);
    expect(r).toMatchObject({ toolCalls: MAX_SEARCHES, turns: 2, capped: true });
    expect(requests[1].tool_choice).toEqual({ type: "none" });
    const last = snapshots[1][2].content as any[];
    expect(last.filter((b) => b.type === "tool_result" && b.is_error)).toHaveLength(2);
    expect(last.at(-1)).toMatchObject({ type: "text" });
    expect(last.at(-1).text).toContain("search budget");
  });

  it("stops at the turn cap: the last allowed turn runs with tools off", async () => {
    const { model, requests } = scripted([]); // never stops asking for a search
    const r = await runAgent({ ...base, search: provider(), model });
    expect(requests).toHaveLength(MAX_TURNS);
    expect(requests.map((q) => (q.tool_choice as { type: string }).type)).toEqual(["auto", "auto", "auto", "none"]);
    expect(r).toMatchObject({ turns: MAX_TURNS, capped: true });
    expect(r.toolCalls).toBeLessThanOrEqual(MAX_SEARCHES);
  });

  it("passes the assistant content back unchanged, thinking blocks included", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-123" } as unknown as Anthropic.ContentBlock;
    const { model, snapshots } = scripted([tools(thinking, call("a", { query: "x" })), answer("ok")]);
    await runAgent({ ...base, search: provider(), model });
    expect((snapshots[1][1].content as any[])[0]).toEqual(thinking);
  });

  it("feeds a failing search back as an error result instead of crashing", async () => {
    const bad: SearchProvider = { name: "bad", search: async () => { throw new Error("boom"); }, read: async () => { throw new Error("boom"); } };
    const { model, snapshots } = scripted([tools(call("a", { query: "x" })), answer("Could not verify.")]);
    const r = await runAgent({ ...base, search: bad, model });
    expect(r.answer).toBe("Could not verify.");
    expect(JSON.stringify(snapshots[1][2])).toContain("boom");
  });

  it("appends Couldn't verify lines for a missing id and a figure not in the source (E13)", async () => {
    const { model } = scripted([
      tools(call("a", { query: "pricing" })),
      answer("Pro costs $42 [R1]. Also see [R7]."),
    ]);
    const events: AgentEvent[] = [];
    const r = await runAgent({ ...base, search: provider(), model, emit: (e) => events.push(e) });
    expect(r.answer).toMatch(/Couldn't verify: \$42 \(cited R1\)\nCouldn't verify: \[R7\] is not a source from this turn$/);
    expect(r.grounding).toHaveLength(2);
    // the note is streamed as a last token event, matching the returned answer
    expect(events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")).toBe(r.answer);
  });

  it("adds the As-of line after a search, not after plain chat", async () => {
    const asOf = "2026-11-11 12:58 (Asia/Kolkata)";
    const searched = scripted([tools(call("a", { query: "x" })), answer("Pro is $99 [R1].")]);
    const r1 = await runAgent({ ...base, search: provider(), model: searched.model, asOf });
    expect(r1.answer).toBe(`Pro is $99 [R1].\n\nAs of ${asOf}`);

    const chat = scripted([answer("Hello!")]);
    const r2 = await runAgent({ ...base, search: provider(), model: chat.model, asOf });
    expect(r2.answer).toBe("Hello!");
  });

  it("returns only the cited results as sources", async () => {
    const { model } = scripted([
      tools(call("a", { query: "one" }), call("b", { query: "two" })),
      answer("Only the second [R2]."),
    ]);
    const r = await runAgent({ ...base, search: provider(), model });
    expect(r.results).toHaveLength(2);
    expect(r.sources.map((s) => s.id)).toEqual(["R2"]);
  });

  it("gives a plain message on a refusal with no text, and flags a max_tokens cut-off", async () => {
    const refusal = scripted([{ content: [], stop_reason: "refusal" }]);
    expect((await runAgent({ ...base, search: provider(), model: refusal.model })).answer).toMatch(/can't help/);
    const cut = scripted([{ content: [text("Half an ans")], stop_reason: "max_tokens" }]);
    expect((await runAgent({ ...base, search: provider(), model: cut.model })).answer).toContain("cut off");
  });
});
