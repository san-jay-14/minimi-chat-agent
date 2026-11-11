import type { Turn } from "../types.js";
import { localParts, nowLine } from "./clock.js";
import { resolveDates } from "./dates.js";
import type { Memory } from "./memory.js";

const MAX_MATCHES = 5;
const MAX_CHARS = 1200;

function formatTurn(t: Turn, tz: string): string {
  const { date, time } = localParts(new Date(t.at), tz);
  const sources = t.sources.map((s) => `${s.url} (published ${s.published ?? "unknown"})`).join("; ");
  const text = `USER: ${t.userMsg} ASSISTANT: ${t.assistantMsg}`;
  const body = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "…" : text;
  return ` [${date} ${time}] ${body}${sources ? ` SOURCES: ${sources}` : ""}`;
}

export function buildBrief(opts: { memory: Memory; userId: string; message: string; now: Date; tz: string }): string {
  const { memory, userId, message, now, tz } = opts;
  const dates = resolveDates(message, now, tz);

  const found = new Map<number, Turn>();
  for (const d of dates) for (const t of memory.onDay(userId, d.date, tz, MAX_MATCHES)) found.set(t.id, t);
  for (const t of memory.search(userId, message, 3)) found.set(t.id, t);
  const matches = [...found.values()].slice(0, MAX_MATCHES);

  const lines = [`NOW: ${nowLine(now, tz)}`];
  if (dates.length) lines.push(`DATES IN MESSAGE: ${dates.map((d) => `"${d.phrase}" -> ${d.date}`).join(", ")}`);
  lines.push(
    matches.length ? `MEMORY MATCHES (${matches.length}):` : "MEMORY MATCHES: none",
    ...matches.map((t) => formatTurn(t, tz)),
  );
  const timeline = memory.timeline(userId, tz);
  if (timeline.length) lines.push(`TIMELINE: ${timeline.map((x) => `${x.date} ${x.first}`).join(" | ")}`);
  return lines.join("\n");
}
