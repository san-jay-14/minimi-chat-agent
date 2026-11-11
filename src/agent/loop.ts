import Anthropic from "@anthropic-ai/sdk";
import { createWebSearch, webSearchTool } from "../search/tool.js";
import type { Result, SearchProvider } from "../search/types.js";
import { checkGrounding, citedSources, type Issue } from "./grounding.js";
import { SYSTEM_PROMPT } from "./prompt.js";

export const MAX_TURNS = 4;
export const MAX_SEARCHES = 10;
const MAX_TOKENS = 8000;

// One real agent action, sent twice: "running" when it starts and "done" when it ends.
export interface Step {
  id: string;
  kind: "memory" | "search" | "read" | "check";
  label: string;
  state: "running" | "done";
  detail?: string;
}

export type AgentEvent = { type: "step"; step: Step } | { type: "token"; text: string };

// The slice of the SDK we use, so tests can swap in a scripted model.
export interface ModelClient {
  stream(params: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }): {
    on(event: "text", cb: (delta: string) => void): unknown;
    finalMessage(): Promise<Anthropic.Message>;
  };
}

export interface AgentInput {
  message: string;
  brief: string;
  asOf?: string; // "2026-11-11 12:58 (Asia/Kolkata)", appended after any answer that used search
  history?: { role: "user" | "assistant"; content: string }[]; // earlier turns of this chat, text only
  search: SearchProvider;
  emit?: (e: AgentEvent) => void;
  signal?: AbortSignal; // the user pressed Stop or closed the tab: end the run, no more spending
  model?: ModelClient;
  // Both exist so the evals can run a naive baseline with the same loop.
  system?: string; // replaces the system prompt
  ground?: boolean; // false skips the grounding check and the As-of line (default true)
}

export interface AgentResult {
  answer: string;
  results: Result[]; // everything the model saw this turn
  sources: Result[]; // the ones the answer cites
  grounding: Issue[];
  toolCalls: number;
  calls: { turn: number; input: unknown }[]; // every tool call the model made, in order
  turns: number;
  ms: number;
  capped: boolean;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const NOTE_BUDGET =
  "You have used your search budget for this question. Answer now with what you have. If anything is unverified because of the limit, say so.";

const stepFor = (input: unknown): Pick<Step, "kind" | "label"> => {
  const i = (input ?? {}) as { query?: string; url?: string };
  return i.url ? { kind: "read", label: `Reading: ${i.url}` } : { kind: "search", label: `Searching: ${i.query ?? ""}`.trim() };
};

// A plain function on purpose: a worker could call it recursively later.
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const t0 = Date.now();
  const model = input.model ?? new Anthropic().messages;
  const emit = input.emit ?? (() => {});
  const tool = createWebSearch(input.search);

  const messages: Anthropic.MessageParam[] = [
    ...(input.history ?? []),
    { role: "user", content: input.brief ? `${input.brief}\n\nUSER MESSAGE:\n${input.message}` : input.message },
  ];
  const seen: Result[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let turns = 0;
  let toolCalls = 0;
  const calls: AgentResult["calls"] = [];
  let capped = false;
  let final = false; // last turn runs with tools switched off
  let answer = "";

  for (;;) {
    input.signal?.throwIfAborted();
    turns++;
    const stream = model.stream(
      {
        model: process.env.MODEL ?? "claude-sonnet-5-5",
        max_tokens: MAX_TOKENS,
        // Tools render before system, so this one breakpoint caches both.
        system: [{ type: "text", text: input.system ?? SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [webSearchTool as Anthropic.Tool],
        tool_choice: { type: final ? "none" : "auto" },
        output_config: { effort: (process.env.EFFORT as "low" | "medium" | "high") ?? "medium" },
        messages,
      },
      { signal: input.signal },
    );
    stream.on("text", (text) => emit({ type: "token", text }));
    const res = await stream.finalMessage();

    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || final || !toolUses.length) {
      answer = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      if (res.stop_reason === "refusal") answer ||= "I can't help with that request.";
      if (res.stop_reason === "max_tokens") answer += "\n\n(The answer was cut off by the output limit.)";
      break;
    }

    // Content goes back exactly as received: thinking blocks must not be edited.
    messages.push({ role: "assistant", content: res.content });

    const room = MAX_SEARCHES - toolCalls;
    const run = toolUses.slice(0, room);
    toolCalls += run.length;
    for (const tu of run) calls.push({ turn: turns, input: tu.input });
    // Each call reports "done" the moment it finishes, not when the slowest one does.
    const done = await Promise.all(
      run.map(async (tu) => {
        const step = { id: tu.id, ...stepFor(tu.input) };
        emit({ type: "step", step: { ...step, state: "running" } });
        const d = await tool.run(tu.input, input.signal);
        const n = d.results.length;
        emit({ type: "step", step: { ...step, state: "done", detail: n ? `${n} result${n === 1 ? "" : "s"}` : "nothing returned" } });
        return d;
      }),
    );
    done.forEach((d) => seen.push(...d.results));

    const content: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => {
      const i = run.indexOf(tu);
      return i >= 0
        ? { type: "tool_result", tool_use_id: tu.id, content: done[i].text }
        : { type: "tool_result", tool_use_id: tu.id, content: "Search limit reached. Not run.", is_error: true };
    });

    if (turns + 1 >= MAX_TURNS || toolCalls >= MAX_SEARCHES) {
      final = capped = true;
      messages.push({ role: "user", content: [...content, { type: "text", text: NOTE_BUDGET }] });
    } else {
      messages.push({ role: "user", content });
    }
  }

  // Tokens already streamed, so the checks arrive as one last chunk.
  const checking = input.ground !== false && seen.length > 0;
  const check = { id: "check", kind: "check", label: "Checking sources" } as const;
  if (checking) emit({ type: "step", step: { ...check, state: "running" } });
  const { issues, notes } = input.ground === false ? { issues: [], notes: [] } : checkGrounding(answer, seen);
  if (checking) emit({ type: "step", step: { ...check, state: "done", detail: issues.length ? `${issues.length} figure${issues.length === 1 ? "" : "s"} unverified` : "figures match the sources" } });
  if (issues.length) console.warn("[grounding]", notes.join(" | "));
  const asOf = input.ground === false ? "" : input.asOf;
  const tail = [asOf && toolCalls > 0 ? `As of ${asOf}` : "", ...notes].filter(Boolean).join("\n");
  if (tail) {
    emit({ type: "token", text: "\n\n" + tail });
    answer += "\n\n" + tail;
  }

  return { answer, results: seen, sources: citedSources(answer, seen), grounding: issues, toolCalls, calls, turns, ms: Date.now() - t0, capped, usage };
}
