import { cleanText } from "./clean.js";
import { SearchError, type RawResult, type SearchProvider, type SearchQuery } from "./types.js";

const BASE = "https://api.tavily.com";

// Tavily says published_date is a best estimate of "published or last updated",
// formatted like an HTTP date. Normalise to YYYY-MM-DD or null.
function toIsoDate(s?: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function post(path: string, key: string, body: object, signal?: AbortSignal) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const j: any = await res.json().catch(() => null);
    throw new SearchError(`tavily ${res.status}: ${j?.detail?.error ?? res.statusText}`, res.status);
  }
  return res.json() as Promise<any>;
}

export function tavily(key: string): SearchProvider {
  return {
    name: "tavily",

    async search(q: SearchQuery, signal) {
      // include_published_date is off by default outside topic=news, and we do
      // not want to restrict to news sources, so we ask for it explicitly.
      const j = await post(
        "/search",
        key,
        {
          query: q.query,
          max_results: q.maxResults,
          include_published_date: true,
          ...(q.startDate && { start_date: q.startDate }),
          ...(q.endDate && { end_date: q.endDate }),
        },
        signal,
      );
      return (j.results ?? []).map(
        (r: any): RawResult => ({
          title: r.title ?? r.url,
          url: r.url,
          published: toIsoDate(r.published_date),
          crawled: null, // Tavily does not expose one for search results
          text: r.content ?? "",
        }),
      );
    },

    // Advanced depth because pricing pages are often rendered client-side.
    async read(url, signal) {
      const j = await post(
        "/extract",
        key,
        { urls: [url], extract_depth: "advanced", format: "markdown", timeout: 15 },
        signal,
      );
      const r = j.results?.[0];
      if (!r) throw new SearchError(`could not read ${url}: ${j.failed_results?.[0]?.error ?? "no content returned"}`);
      const heading = cleanText(/^#\s+(.+)$/m.exec(r.raw_content ?? "")?.[1] ?? "");
      return {
        title: heading || new URL(url).hostname,
        url: r.url ?? url,
        published: null, // extract returns no date
        crawled: new Date().toISOString(),
        text: r.raw_content ?? "",
      };
    },
  };
}
