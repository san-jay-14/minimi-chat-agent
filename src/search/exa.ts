import { SearchError, type RawResult, type SearchProvider, type SearchQuery } from "./types.js";

const BASE = "https://api.exa.ai";

// publishedDate is an estimate parsed from the page's HTML. Exa has no crawl date.
const toIsoDate = (s?: string | null) => (s && !Number.isNaN(new Date(s).getTime()) ? new Date(s).toISOString().slice(0, 10) : null);

async function post(path: string, key: string, body: object, signal?: AbortSignal) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const j: any = await res.json().catch(() => null);
    throw new SearchError(`exa ${res.status}: ${j?.error ?? res.statusText}`, res.status);
  }
  return res.json() as Promise<any>;
}

export function exa(key: string): SearchProvider {
  return {
    name: "exa",

    async search(q: SearchQuery, signal) {
      // Highlights are the passages most relevant to the query, a closer match to
      // what Tavily returns as `content` than the first characters of the page.
      const j = await post(
        "/search",
        key,
        {
          query: q.query,
          type: "auto",
          numResults: q.maxResults,
          contents: { highlights: { maxCharacters: 1500 } },
          ...(q.startDate && { startPublishedDate: `${q.startDate}T00:00:00.000Z` }),
          ...(q.endDate && { endPublishedDate: `${q.endDate}T23:59:59.999Z` }),
        },
        signal,
      );
      return (j.results ?? []).map(
        (r: any): RawResult => ({
          title: r.title ?? r.url,
          url: r.url,
          published: toIsoDate(r.publishedDate),
          crawled: null,
          text: (r.highlights ?? []).join("\n"),
        }),
      );
    },

    // maxAgeHours 0 forces a live fetch, which is the point of a live read.
    async read(url, signal) {
      const j = await post("/contents", key, { urls: [url], text: { maxCharacters: 12000 }, maxAgeHours: 0, livecrawlTimeout: 15000 }, signal);
      const r = j.results?.[0];
      if (!r) throw new SearchError(`could not read ${url}: ${j.statuses?.[0]?.error?.tag ?? "no content returned"}`);
      return {
        title: r.title || new URL(url).hostname,
        url: r.url ?? url,
        published: toIsoDate(r.publishedDate),
        crawled: new Date().toISOString(),
        text: r.text ?? "",
      };
    },
  };
}
