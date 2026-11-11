import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrief } from "../src/context/brief.js";
import { Memory, type NewTurn } from "../src/context/memory.js";

const turn = (over: Partial<NewTurn> = {}): NewTurn => ({
  userId: "u1",
  sessionId: "s1",
  userMsg: "Compare HubSpot and Pipedrive pricing",
  assistantMsg: "HubSpot starts at $20 per seat, Pipedrive at $14.",
  at: "2026-11-09T05:30:00Z",
  tz: "UTC",
  sources: [],
  ...over,
});

describe("Memory", () => {
  it("saves a turn and ignores an exact duplicate", () => {
    const m = new Memory();
    expect(m.save(turn())).toBe(true);
    expect(m.save(turn({ at: "2030-01-01T00:00:00Z" }))).toBe(false);
  });

  it("persists to disk and reloads", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mem-")), "nested", "memory.json");
    new Memory(path).save(turn());
    expect(new Memory(path).search("u1", "hubspot")).toHaveLength(1);
  });

  it("ranks keyword matches and skips non-matches", () => {
    const m = new Memory();
    m.save(turn());
    m.save(turn({ userMsg: "Best Postgres hosting?", assistantMsg: "Neon, Supabase, RDS.", at: "2026-11-03T05:30:00Z" }));
    const hits = m.search("u1", "has postgres hosting pricing changed");
    expect(hits[0].userMsg).toContain("Postgres");
    expect(m.search("u1", "quantum entanglement")).toEqual([]);
  });

  it("finds turns by local day in the request timezone", () => {
    const m = new Memory();
    m.save(turn({ at: "2026-11-03T20:00:00Z" })); // 4 Nov 01:30 in Kolkata
    expect(m.onDay("u1", "2026-11-03", "UTC")).toHaveLength(1);
    expect(m.onDay("u1", "2026-11-03", "Asia/Kolkata")).toHaveLength(0);
    expect(m.onDay("u1", "2026-11-04", "Asia/Kolkata")).toHaveLength(1);
  });

  it("never shows one user's turns to another", () => {
    const m = new Memory();
    m.save(turn());
    expect(m.search("u2", "hubspot")).toEqual([]);
    expect(m.onDay("u2", "2026-11-09", "UTC")).toEqual([]);
    expect(m.timeline("u2", "UTC")).toEqual([]);
  });

  it("seeds from history idempotently, pairing user and assistant messages", () => {
    const m = new Memory();
    const history = [
      { role: "user" as const, content: "CRM shortlist: A, B, C", at: "2026-11-09T05:00:00Z" },
      { role: "assistant" as const, content: "Noted." },
      { role: "user" as const, content: "and the current question" },
    ];
    expect(m.seed("u1", "s1", history, "2026-11-11T00:00:00Z", "UTC")).toBe(1);
    expect(m.seed("u1", "s1", history, "2026-11-12T00:00:00Z", "UTC")).toBe(0);
    expect(m.onDay("u1", "2026-11-09", "UTC")[0].userMsg).toBe("CRM shortlist: A, B, C");
  });

  it("builds a timeline of sessions, newest first, first message cut to 80 chars", () => {
    const m = new Memory();
    m.save(turn({ sessionId: "a", userMsg: "x".repeat(200), at: "2026-11-03T05:00:00Z" }));
    m.save(turn({ sessionId: "b", userMsg: "later", assistantMsg: "ok", at: "2026-11-09T05:00:00Z" }));
    const tl = m.timeline("u1", "UTC");
    expect(tl.map((x) => x.date)).toEqual(["2026-11-09", "2026-11-03"]);
    expect(tl[1].first).toHaveLength(80);
  });
});

describe("buildBrief", () => {
  const now = new Date("2026-11-11T07:28:00Z");

  it("injects now, resolved dates, the matching turn and the timeline", () => {
    const m = new Memory();
    m.save(turn({ sources: [{ title: "HubSpot", url: "https://hubspot.com/pricing", published: "2026-10-01" }] }));
    const brief = buildBrief({ memory: m, userId: "u1", message: "anything changed since Monday?", now, tz: "UTC" });
    expect(brief).toContain("NOW: 2026-11-11 07:28 (UTC), Wednesday");
    expect(brief).toContain('DATES IN MESSAGE: "Monday" -> 2026-11-09');
    expect(brief).toContain("MEMORY MATCHES (1):");
    expect(brief).toContain("https://hubspot.com/pricing (published 2026-10-01)");
    expect(brief).toContain("TIMELINE: 2026-11-09 Compare HubSpot");
  });

  it("says none when nothing matches", () => {
    const brief = buildBrief({
      memory: new Memory(),
      userId: "u1",
      message: "What did I ask on 3 November?",
      now,
      tz: "UTC",
    });
    expect(brief).toContain("MEMORY MATCHES: none");
    expect(brief).not.toContain("TIMELINE");
  });

  it("caps matches at 5", () => {
    const m = new Memory();
    for (let i = 0; i < 8; i++) m.save(turn({ userMsg: `hubspot question ${i}`, at: `2026-11-09T0${i}:00:00Z` }));
    const brief = buildBrief({ memory: m, userId: "u1", message: "hubspot since Monday", now, tz: "UTC" });
    expect(brief).toContain("MEMORY MATCHES (5):");
  });
});
