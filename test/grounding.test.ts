import { describe, expect, it } from "vitest";
import { checkGrounding, citedSources } from "../src/agent/grounding.js";
import type { Result } from "../src/search/types.js";

const r = (id: string, text: string, over: Partial<Result> = {}): Result => ({
  id,
  title: `Title ${id}`,
  url: `https://x.com/${id}`,
  published: "2026-11-01",
  crawled: null,
  snippet: text,
  ...over,
});

const results = [
  r("R1", "Starter costs $20 per seat per month. Pro is $1,500 per month and 15% off annually."),
  r("R2", "Version 2.4.1 shipped. Pipedrive Lite is US$14.00 per user."),
  r("R3", "Enterprise: 5 seats included.", { content: "Enterprise is $2,000 a month.", snippet: "short" }),
];

const notes = (answer: string) => checkGrounding(answer, results).notes;

describe("checkGrounding", () => {
  it("passes when every cited figure is in the cited result", () => {
    expect(notes("Starter is $20 per seat [R1].")).toEqual([]);
  });

  it("flags a citation to a result that does not exist", () => {
    expect(notes("It costs a lot [R9].")).toEqual(["Couldn't verify: [R9] is not a source from this turn"]);
  });

  it("flags a price that is not in the cited result", () => {
    expect(notes("Starter is $25 per seat [R1].")).toEqual(["Couldn't verify: $25 (cited R1)"]);
  });

  it("flags a percentage and a version number that are not in the source", () => {
    expect(notes("It is 40% cheaper [R1].")).toEqual(["Couldn't verify: 40% (cited R1)"]);
    expect(notes("The latest is v3.0.0 [R2].")).toEqual(["Couldn't verify: v3.0.0 (cited R2)"]);
  });

  it("accepts figures that match after normalising commas, decimals and symbols", () => {
    expect(notes("Pro is $1500 [R1], 15 % off [R1], Lite is $14 [R2], version 2.4.1 [R2].")).toEqual([]);
    expect(notes("Pro is US$1,500.00 [R1].")).toEqual([]);
    expect(notes("Lite is 14 USD [R2].")).toEqual([]);
  });

  it("accepts a decimal figure that rounds or truncates a more precise source number", () => {
    const fx = [r("R1", "1 USD = 95.22102931 INR, or 7.46 percent more, version 3.10.2")];
    const n = (a: string) => checkGrounding(a, fx).notes;
    expect(n("The rate is 95.2 INR [R1].")).toEqual([]); // truncated and rounded
    expect(n("The rate is 95.22 INR [R1].")).toEqual([]);
    expect(n("It is 7.5% more [R1].")).toEqual([]); // rounded up
    expect(n("The rate is 95.3 INR [R1].")).toEqual(["Couldn't verify: 95.3 INR (cited R1)"]);
    expect(n("The rate is 96 INR [R1].")).toEqual(["Couldn't verify: 96 INR (cited R1)"]); // integers stay exact
  });

  it("checks against the text the model saw: content for live reads, snippet otherwise", () => {
    expect(notes("Enterprise is $2,000 [R3].")).toEqual([]);
    expect(notes("Enterprise is $5 [R3].")).toEqual(["Couldn't verify: $5 (cited R3)"]);
  });

  it("with several citations in one sentence, a figure may come from any of them", () => {
    expect(notes("Starter is $20 [R1] and Lite is $14 [R2].")).toEqual([]);
    expect(notes("Both cost about $20 or $14 [R1][R2].")).toEqual([]);
    expect(notes("Both cost $99 [R1, R2].")).toEqual(["Couldn't verify: $99 (cited R1, R2)"]);
  });

  it("does not check sentences that carry no citation (derived figures)", () => {
    expect(notes("Starter is $20 per seat [R1]. For 20 seats that is $400 a month.")).toEqual([]);
  });

  it("checks table cells separately, so an uncited derived cell is fine", () => {
    const table = "| Tool | Per seat | 20 seats |\n|---|---|---|\n| HubSpot | $20 [R1] | $400/month |";
    expect(notes(table)).toEqual([]);
    expect(notes("| HubSpot | $21 [R1] | $400/month |")).toEqual(["Couldn't verify: $21 (cited R1)"]);
  });

  it("ignores plain integers and dates", () => {
    expect(notes("On 2026-11-09 there were 7 changes across 20 seats [R1].")).toEqual([]);
  });

  it("reports each problem once and in order", () => {
    const out = notes("A is $25 [R1]. B is $25 [R1]. C [R8]. D is $7 [R2].");
    expect(out).toEqual([
      "Couldn't verify: $25 (cited R1)",
      "Couldn't verify: [R8] is not a source from this turn",
      "Couldn't verify: $7 (cited R2)",
    ]);
  });

  it("returns structured issues too", () => {
    expect(checkGrounding("A is $25 [R1].", results).issues).toEqual([{ kind: "figure", figure: "$25", cited: ["R1"] }]);
  });
});

describe("citedSources", () => {
  it("lists cited results once each, in order of first mention, skipping unknown ids", () => {
    const out = citedSources("B [R2]. A [R1]. Again [R2]. Ghost [R9].", results);
    expect(out.map((x) => x.id)).toEqual(["R2", "R1"]);
  });
});
