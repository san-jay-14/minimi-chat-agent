import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HistoryMessage, Source, Turn } from "../types.js";
import { localDate } from "./clock.js";

const STOP = new Set(
  "a an the and or but of to in on at for from with by is are was were be been it its this that these those i you we they my your our me what which who when where why how did do does has have had can could would should will about any since ago last again still now today yesterday asked ask said tell".split(
    " ",
  ),
);

export const keywords = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

const hashOf = (userId: string, userMsg: string, assistantMsg: string) =>
  createHash("sha256").update([userId, userMsg, assistantMsg].join("\u0000")).digest("hex");

export type NewTurn = Omit<Turn, "id" | "hash">;

// Everything lives in one JSON file, loaded once. Every query filters by user
// first, so one user can never see another's turns.
export class Memory {
  private turns: Turn[] = [];

  constructor(private path?: string) {
    if (path && existsSync(path)) this.turns = JSON.parse(readFileSync(path, "utf8")).turns;
  }

  // Returns false if an identical exchange was already stored.
  save(t: NewTurn): boolean {
    const hash = hashOf(t.userId, t.userMsg, t.assistantMsg);
    if (this.turns.some((x) => x.hash === hash)) return false;
    this.turns.push({ ...t, id: this.turns.length + 1, hash });
    this.flush();
    return true;
  }

  // Pairs consecutive user/assistant messages. An unpaired trailing user
  // message is dropped: it is the question being asked right now.
  seed(
    userId: string,
    sessionId: string,
    history: HistoryMessage[],
    fallbackAt: string,
    tz: string,
    sources: Source[] = [],
  ): number {
    let added = 0;
    for (let i = 0; i + 1 < history.length; i++) {
      const [u, a] = [history[i], history[i + 1]];
      if (u.role !== "user" || a.role !== "assistant") continue;
      const at = new Date(u.at ?? fallbackAt).toISOString();
      if (this.save({ userId, sessionId, userMsg: u.content, assistantMsg: a.content, at, tz, sources })) added++;
      i++;
    }
    return added;
  }

  // The latest turns of one chat, oldest first, used as the running conversation.
  session(userId: string, sessionId: string, limit = 6): Turn[] {
    return this.mine(userId)
      .filter((t) => t.sessionId === sessionId)
      .slice(-limit);
  }

  onDay(userId: string, date: string, tz: string, limit = 5): Turn[] {
    return this.mine(userId)
      .filter((t) => localDate(new Date(t.at), tz) === date)
      .slice(0, limit);
  }

  // BM25 over the user's own turns.
  search(userId: string, query: string, limit = 3): Turn[] {
    const docs = this.mine(userId).map((t) => ({ t, words: keywords(t.userMsg + " " + t.assistantMsg) }));
    const q = [...new Set(keywords(query))];
    if (!docs.length || !q.length) return [];
    const avg = docs.reduce((n, d) => n + d.words.length, 0) / docs.length;
    const k1 = 1.2;
    const b = 0.75;
    return docs
      .map(({ t, words }) => {
        let score = 0;
        for (const term of q) {
          const tf = words.filter((w) => w === term).length;
          if (!tf) continue;
          const df = docs.filter((d) => d.words.includes(term)).length;
          const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
          score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * words.length) / avg));
        }
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.t);
  }

  // One line per session, newest first.
  timeline(userId: string, tz: string, limit = 20): { date: string; first: string }[] {
    const first = new Map<string, Turn>();
    for (const t of this.mine(userId)) if (!first.has(t.sessionId)) first.set(t.sessionId, t);
    return [...first.values()]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((t) => ({ date: localDate(new Date(t.at), tz), first: t.userMsg.slice(0, 80) }));
  }

  private mine(userId: string): Turn[] {
    return this.turns.filter((t) => t.userId === userId).sort((a, b) => a.at.localeCompare(b.at));
  }

  // Write to a temp file then rename so a crash never leaves half a file.
  private flush() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify({ turns: this.turns }));
    renameSync(tmp, this.path);
  }
}
