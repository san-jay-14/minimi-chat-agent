import { describe, expect, it, vi } from "vitest";
import type { AgentInput, AgentResult } from "../src/agent/loop.js";
import { createApp } from "../src/app.js";
import { Memory } from "../src/context/memory.js";
import type { SearchProvider } from "../src/search/types.js";

const search = (): SearchProvider => ({ name: "fake", search: async () => [], read: async () => { throw new Error("unused"); } });

const result = (over: Partial<AgentResult> = {}): AgentResult => ({
  answer: "Hello there",
  results: [],
  sources: [],
  grounding: [],
  toolCalls: 0,
  calls: [],
  turns: 1,
  ms: 5,
  capped: false,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ...over,
});

// A fake agent that streams its answer as two tokens.
const fakeRun = (over: Partial<AgentResult> = {}, delayMs = 0) =>
  vi.fn(async (input: AgentInput) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const r = result(over);
    input.emit?.({ type: "token", text: r.answer.slice(0, 5) });
    input.emit?.({ type: "token", text: r.answer.slice(5) });
    return r;
  });

const setup = (run = fakeRun()) => {
  const memory = new Memory();
  const app = createApp({ memory, run, search });
  const post = (body: unknown) =>
    app.request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { memory, app, post, run };
};

type Frame = { event: string; data: any };
const frames = async (res: Response): Promise<Frame[]> =>
  (await res.text())
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((f) => ({
      event: /^event: (.*)$/m.exec(f)![1],
      data: JSON.parse(/^data: (.*)$/m.exec(f)![1]),
    }));

describe("GET /", () => {
  it("serves the chat page", async () => {
    const res = await setup().app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Minimi chat agent");
  });
});

describe("POST /chat", () => {
  it("rejects a bad body with 400", async () => {
    const { post, run } = setup();
    expect((await post({})).status).toBe(400);
    expect((await post({ message: "   " })).status).toBe(400);
    expect((await post({ message: "hi", client_time: "yesterday" })).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("streams status first, then tokens, sources and done", async () => {
    const src = { id: "R1", title: "T", url: "https://a.com", published: "2026-11-01", crawled: null, snippet: "s" };
    const { post } = setup(fakeRun({ sources: [src], toolCalls: 2, turns: 2 }));
    const out = await frames(await post({ message: "hi" }));
    expect(out.map((f) => f.event)).toEqual(["status", "token", "token", "sources", "done"]);
    expect(out[1].data.text + out[2].data.text).toBe("Hello there");
    expect(out[3].data).toEqual([{ id: "R1", title: "T", url: "https://a.com", published: "2026-11-01", read_live_at: null }]);
    expect(out[4].data).toMatchObject({ toolCalls: 2, turns: 2 });
  });

  it("sends the first status within 300 ms even when the agent is slow (E17)", async () => {
    const { post } = setup(fakeRun({}, 800));
    const t0 = Date.now();
    const res = await post({ message: "hi" });
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(Date.now() - t0).toBeLessThan(300);
    expect(first).toContain("event: status");
    await reader.cancel();
  });

  it("saves the finished turn to memory, with defaults for user and session", async () => {
    const { post, memory } = setup();
    await frames(await post({ message: "What is a CRM?", client_time: "2026-11-11T12:58:00+05:30", tz: "Asia/Kolkata" }));
    const [turn] = memory.onDay("anon", "2026-11-11", "Asia/Kolkata");
    expect(turn).toMatchObject({ userMsg: "What is a CRM?", assistantMsg: "Hello there", sessionId: "default", tz: "Asia/Kolkata", at: "2026-11-11T07:28:00.000Z" });
  });

  it("builds the brief from client_time and tz", async () => {
    const { post, run } = setup();
    await frames(await post({ message: "since Monday?", client_time: "2026-11-11T12:58:00+05:30", tz: "Asia/Kolkata" }));
    const input = run.mock.calls[0][0];
    expect(input.brief).toContain("NOW: 2026-11-11 12:58 (Asia/Kolkata), Wednesday");
    expect(input.brief).toContain('"Monday" -> 2026-11-09');
    expect(input.asOf).toBe("2026-11-11 12:58 (Asia/Kolkata), Wednesday");
  });

  it("seeds memory from history, idempotently, and the brief then finds it (E3)", async () => {
    const { post, run, memory } = setup();
    const history = [
      { role: "user", content: "Best Postgres hosting?", at: "2026-11-03T08:00:00Z" },
      { role: "assistant", content: "Neon or Supabase." },
    ];
    const body = { message: "What did I ask you on 3 November?", client_time: "2026-11-11T07:28:00Z", tz: "UTC", history };
    await frames(await post(body));
    await frames(await post(body));
    expect(run.mock.calls[0][0].brief).toContain("USER: Best Postgres hosting? ASSISTANT: Neon or Supabase.");
    expect(memory.onDay("anon", "2026-11-03", "UTC")).toHaveLength(1);
  });

  it("gives user B cold-start behaviour for user A's history (E16)", async () => {
    const { post, run } = setup();
    await frames(await post({ user_id: "A", message: "Best Postgres hosting?" }));
    await frames(await post({ user_id: "B", message: "What did I ask about Postgres hosting?" }));
    expect(run.mock.calls[1][0].brief).toContain("MEMORY MATCHES: none");
    expect(run.mock.calls[1][0].history).toEqual([]);
  });

  it("passes the earlier turns of the same session as the running conversation (E14)", async () => {
    const { post, run } = setup();
    await frames(await post({ session_id: "s1", message: "Compare A, B and C" }));
    await frames(await post({ session_id: "s1", message: "what about the third one?" }));
    await frames(await post({ session_id: "s2", message: "new chat" }));
    expect(run.mock.calls[1][0].history).toEqual([
      { role: "user", content: "Compare A, B and C" },
      { role: "assistant", content: "Hello there" },
    ]);
    expect(run.mock.calls[2][0].history).toEqual([]);
  });

  it("sends an error event and saves nothing when the agent fails", async () => {
    const boom = vi.fn(async () => { throw new Error("model down"); });
    const { post, memory } = setup(boom as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await frames(await post({ message: "hi" }));
    expect(out.at(-1)).toEqual({ event: "error", data: { message: "model down" } });
    expect(memory.search("anon", "hi")).toEqual([]);
  });

  it("reports a missing search key as an error event, not a crash", async () => {
    const app = createApp({ memory: new Memory(), run: fakeRun(), search: () => { throw new Error("TAVILY_API_KEY is not set"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("/chat", { method: "POST", body: JSON.stringify({ message: "hi" }), headers: { "Content-Type": "application/json" } });
    expect((await frames(res)).at(-1)).toEqual({ event: "error", data: { message: "TAVILY_API_KEY is not set" } });
  });
});
