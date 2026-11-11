import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SearchError, type RawResult, type SearchProvider } from "./types.js";

// A recorded call. `error` replays a failed read. Hand-written cassettes can use
// the keys "search *" and "read *" to answer any call of that kind.
type Entry = { key: string; result?: RawResult[] | RawResult; error?: string };

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const similarity = (a: string, b: string) => {
  const [x, y] = [words(a), words(b)];
  const both = [...x].filter((w) => y.has(w)).length;
  return both / ((x.size + y.size - both) || 1);
};
const textOf = (key: string) => (key.startsWith("search ") ? (JSON.parse(key.slice(7)).query as string) : key.slice(5));
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// A model rarely repeats a query word for word, so replay falls back to the
// closest recorded call of the same kind. Below the threshold it fails loudly.
const MIN_SIMILARITY = 0.3;

function lookup(entries: Entry[], key: string): Entry | undefined {
  const kind = key.split(" ")[0];
  const ofKind = entries.filter((e) => e.key.startsWith(kind + " ") && !e.key.endsWith(" *"));
  const exact = ofKind.find((e) => e.key === key);
  if (exact) return exact;
  const wanted = textOf(key);
  const near = ofKind
    .map((e) => ({ e, s: kind === "read" ? (hostOf(textOf(e.key)) === hostOf(wanted) ? 1 : 0) : similarity(textOf(e.key), wanted) }))
    .sort((a, b) => b.s - a.s)[0];
  if (near && near.s >= MIN_SIMILARITY) return near.e;
  return entries.find((e) => e.key === kind + " *");
}

// record: call the real provider and save what it returned.
// replay: serve the saved answers, and fail loudly on a call nothing matches.
export function withCassette(file: string, mode: "record" | "replay", real?: SearchProvider): SearchProvider {
  const entries: Entry[] = mode === "replay" ? JSON.parse(readFileSync(file, "utf8")) : [];

  async function through<T extends RawResult[] | RawResult>(key: string, live: () => Promise<T>): Promise<T> {
    if (mode === "replay") {
      const hit = lookup(entries, key);
      if (!hit) throw new Error(`cassette ${file} has no entry for ${key}`);
      if (hit.error) throw new SearchError(hit.error);
      return hit.result as T;
    }
    let entry: Entry;
    try {
      entry = { key, result: await live() };
    } catch (e) {
      // Failed reads are worth replaying too. Network or auth errors are not.
      if (e instanceof SearchError && e.status === undefined) entries.push({ key, error: e.message });
      else throw e;
      save();
      throw e;
    }
    entries.push(entry);
    save();
    return entry.result as T;
  }

  function save() {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(entries, null, 2));
  }

  return {
    name: real?.name ?? "cassette",
    search: (q, s) => through("search " + JSON.stringify(q), () => real!.search(q, s)),
    read: (url, s) => through("read " + url, () => real!.read(url, s)),
  };
}
