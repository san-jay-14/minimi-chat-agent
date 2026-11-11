import { z } from "zod";
import { clean } from "./clean.js";
import { SearchError, type Result, type SearchProvider } from "./types.js";

const SEARCH_MS = 8_000;
const READ_MS = 20_000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

const shape = z.object({
  query: z.string().min(1).optional().describe("Search query. Use this OR url."),
  url: z.url().optional().describe("Read this page live right now. Use this OR query."),
  start_date: date.optional().describe("Only results published on or after this date. For news and changelog searches."),
  end_date: date.optional().describe("Only results published on or before this date."),
  max_results: z.number().int().min(1).max(10).optional().describe("Default 5."),
});

export const inputSchema = shape.refine((i) => (i.query === undefined) !== (i.url === undefined), {
  message: "provide exactly one of query or url",
});

// One tool with two modes: a search, or a live read of one page. Both return the
// same result shape, which keeps it a single tool for the model.
export const webSearchTool = {
  name: "web_search",
  description:
    "Search the web, or read one page live. Pass `query` to search (optionally with start_date/end_date for news and changelogs). " +
    "Pass `url` to read that page as it is right now, e.g. an official pricing page. Provide exactly one of the two.",
  input_schema: (({ $schema, ...rest }) => rest)(z.toJSONSchema(shape) as Record<string, unknown>),
};

const retryable = (e: unknown) => !(e instanceof SearchError) || e.status === 429 || (e.status ?? 0) >= 500;

// One retry on timeouts, network errors, 429 and 5xx. A 4xx will not get better.
async function withRetry<T>(ms: number, fn: (s: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await fn(AbortSignal.timeout(ms));
  } catch (e) {
    if (!retryable(e)) throw e;
    return await fn(AbortSignal.timeout(ms));
  }
}

// Results are untrusted text. Neutralise anything that could close our wrapper early.
const defang = (s: string) => s.replace(/<(\/?)search_results/gi, "<$1 search_results");

export function formatResults(results: Result[], error?: string): string {
  const body = results
    .map((r) =>
      [
        `[${r.id}] ${r.title}`,
        `url: ${r.url}`,
        `published: ${r.published ?? "unknown"}`,
        r.crawled ? `read live at: ${r.crawled}` : null,
        r.content ?? r.snippet,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return `<search_results${error ? ` error="${error.replace(/"/g, "'")}"` : ""}>\n${defang(body)}\n</search_results>`;
}

// One instance per turn: ids R1, R2... stay unique across every call in it.
export function createWebSearch(provider: SearchProvider) {
  let next = 1;
  return {
    async run(input: unknown): Promise<{ results: Result[]; text: string }> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { results: [], text: formatResults([], parsed.error.issues.map((i) => i.message).join("; ")) };
      const i = parsed.data;
      try {
        const raw = i.url
          ? [await withRetry(READ_MS, (s) => provider.read(i.url!, s))]
          : await withRetry(SEARCH_MS, (s) =>
              provider.search({ query: i.query!, startDate: i.start_date, endDate: i.end_date, maxResults: i.max_results ?? 5 }, s),
            );
        const results = clean(raw, next, !!i.url);
        next += results.length;
        return { results, text: formatResults(results) };
      } catch (e) {
        return { results: [], text: formatResults([], e instanceof Error ? e.message : String(e)) };
      }
    },
  };
}
