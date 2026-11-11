import type { RawResult, Result } from "./types.js";

export const SNIPPET_MAX = 1500;
export const CONTENT_MAX = 6000;

const BOILERPLATE =
  /^(skip to (main )?content|menu|search|sign in|log in|sign up|subscribe|accept( all)? cookies?|cookie (settings|policy|preferences)|privacy policy|terms( of (service|use))?|share|follow us|back to top|©.*)$/i;

const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() + "…" : s);

const PRICE = /[$€£₹¥]\s?\d|\d\s?(?:USD|EUR|GBP|INR)\b/;

// Some pricing pages put the price table after 14k characters of marketing text.
// Cutting at the cap would hide every price, so when the first price lies beyond
// it we keep the head of the page plus a window that starts just before the price.
function fit(text: string, max: number): string {
  const first = text.search(PRICE);
  if (text.length <= max || first < max - 500) return cut(text, max);
  return text.slice(0, 400).trimEnd() + "\n…\n" + cut(text.slice(Math.max(0, first - 300)), max - 404);
}

// A line that is nothing but a link is navigation or a button, not content.
const LINK_ONLY = /^\s*(?:[*+-]\s*)?\[[^\]]*\]\([^)]*\)\s*$/;

export function cleanText(text: string): string {
  const lines = text
    .split("\n")
    .filter((l) => !LINK_ONLY.test(l))
    .join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2 && /[\p{L}\p{N}]/u.test(l) && !BOILERPLATE.test(l));
  return lines.filter((l, i) => l !== lines[i - 1]).join("\n");
}

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (k.startsWith("utm_")) x.searchParams.delete(k);
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search).toLowerCase();
  } catch {
    return u;
  }
}

const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

function nearSame(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const both = [...a].filter((w) => b.has(w)).length;
  return both / (a.size + b.size - both) >= 0.85;
}

// Ids continue from `nextId` so they stay unique across all calls in one turn.
export function clean(raw: RawResult[], nextId: number, live = false): Result[] {
  const seenUrls = new Set<string>();
  const kept: { r: RawResult; title: Set<string> }[] = [];
  for (const r of raw) {
    const key = normUrl(r.url);
    const title = words(r.title);
    if (seenUrls.has(key) || kept.some((k) => nearSame(k.title, title))) continue;
    seenUrls.add(key);
    kept.push({ r, title });
  }
  return kept.map(({ r }, i) => {
    const text = cleanText(r.text);
    const base = { id: `R${nextId + i}`, title: cut(r.title.trim(), 120), url: r.url, published: r.published, crawled: r.crawled };
    return live
      ? { ...base, snippet: cut(text, 300), content: fit(text, CONTENT_MAX) }
      : { ...base, snippet: cut(text, SNIPPET_MAX) };
  });
}
