import type { Result } from "../search/types.js";

export interface Issue {
  kind: "missing" | "figure";
  figure?: string;
  cited: string[];
}

const CITE = /\[(R\d+(?:\s*[,;]\s*R\d+)*)\]/g;

// Prices, percentages and version numbers. Plain integers ("20 seats", years)
// are ignored on purpose: checking them would flag almost every sentence.
const FIGURE =
  /(?:US\$|[$€£₹¥])\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:USD|EUR|GBP|INR)\b|(\d+(?:\.\d+)?)\s?%|\bv(\d+(?:\.\d+)*)\b|\b(\d+\.\d+\.\d+)\b/gi;

// "1,500" and "1500" and "14.00" and "14" compare equal.
const norm = (s: string) => {
  const n = s.replace(/,/g, "");
  return n.includes(".") ? n.replace(/0+$/, "").replace(/\.$/, "") : n;
};

const decimals = (n: string) => n.split(".")[1]?.length ?? 0;

// A figure with decimals may be a rounding or truncation of a more precise source
// number ("95.2" from "95.22102931"). Integers stay exact: "$14" is not "14.99".
function inSource(value: string, nums: Set<string>): boolean {
  const v = norm(value);
  if (nums.has(v)) return true;
  const d = decimals(v);
  if (!d || v.split(".").length !== 2) return false;
  return [...nums].some(
    (s) => s.split(".").length === 2 && decimals(s) > d && (s.startsWith(v) || norm(Number(s).toFixed(d)) === v),
  );
}

const numbersIn =(text: string) => new Set((text.match(/\d+(?:,\d{3})*(?:\.\d+)*/g) ?? []).map(norm));

// Exactly what the model was shown for this result.
const textOf = (r: Result) => `${r.title} ${r.content ?? r.snippet}`;

// A table cell or a sentence is the unit: a citation vouches for the figures next to it.
function units(answer: string): string[] {
  return answer
    .split("\n")
    .flatMap((line) => (line.includes("|") ? line.split("|") : line.split(/(?<=[.!?])\s+(?=[A-Z0-9$"(*])/)));
}

const idsIn = (unit: string) => [...unit.matchAll(CITE)].flatMap((m) => m[1].split(/[,;]/).map((s) => s.trim()));

export function checkGrounding(answer: string, results: Result[]): { issues: Issue[]; notes: string[] } {
  const byId = new Map(results.map((r) => [r.id, numbersIn(textOf(r))]));
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const add = (i: Issue) => {
    const key = `${i.kind}|${i.figure ?? ""}|${i.cited.join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(i);
    }
  };

  for (const unit of units(answer)) {
    const ids = idsIn(unit);
    if (!ids.length) continue;
    for (const id of ids) if (!byId.has(id)) add({ kind: "missing", cited: [id] });
    const known = ids.filter((id) => byId.has(id));
    if (!known.length) continue;

    const allowed = new Set(known.flatMap((id) => [...byId.get(id)!]));
    for (const m of unit.matchAll(FIGURE)) {
      const value = m.slice(1).find((g) => g !== undefined)!;
      if (!inSource(value, allowed)) add({ kind: "figure", figure: m[0].trim(), cited: known });
    }
  }

  const notes = issues.map((i) =>
    i.kind === "missing"
      ? `Couldn't verify: [${i.cited[0]}] is not a source from this turn`
      : `Couldn't verify: ${i.figure} (cited ${i.cited.join(", ")})`,
  );
  return { issues, notes };
}

// Results the answer actually cites, in order of first mention.
export function citedSources(answer: string, results: Result[]): Result[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const out: Result[] = [];
  for (const id of idsIn(answer)) {
    const r = byId.get(id);
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}
