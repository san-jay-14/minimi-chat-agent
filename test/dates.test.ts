import { describe, expect, it } from "vitest";
import { nowLine } from "../src/context/clock.js";
import { resolveDates } from "../src/context/dates.js";

// Wednesday 2026-11-11, 12:58 in Kolkata
const now = new Date("2026-11-11T07:28:00Z");
const dates = (msg: string, at = now, tz = "Asia/Kolkata") => resolveDates(msg, at, tz).map((d) => d.date);

describe("resolveDates", () => {
  it("resolves a bare weekday to the most recent one", () => {
    expect(dates("On Monday we shortlisted 5 tools")).toEqual(["2026-11-09"]);
  });
  it("resolves 'since Monday'", () => {
    expect(resolveDates("anything new since Monday?", now, "Asia/Kolkata")).toEqual([
      { phrase: "Monday", date: "2026-11-09" },
    ]);
  });
  it("returns both readings of 'last Tuesday' (most recent, and a week earlier)", () => {
    expect(dates("Last Tuesday I asked about Postgres hosting")).toEqual(["2026-11-10", "2026-11-03"]);
  });
  it("resolves '3 Nov' and '3 November' in the current year", () => {
    expect(dates("What did I ask you on 3 November?")).toEqual(["2026-11-03"]);
    expect(dates("on 3 Nov")).toEqual(["2026-11-03"]);
  });
  it("does not pick a future date for a day-month without a year", () => {
    expect(dates("what about 3 November?", new Date("2026-01-15T10:00:00Z"), "UTC")).toEqual(["2025-11-03"]);
  });
  it("returns nothing when there is no date", () => {
    expect(dates("Who is the CEO of Stripe?")).toEqual([]);
  });
  it("uses the request timezone near midnight", () => {
    // 19:00 UTC on 11 Nov is already 00:30 on 12 Nov in Kolkata
    const late = new Date("2026-11-11T19:00:00Z");
    expect(dates("yesterday", late, "Asia/Kolkata")).toEqual(["2026-11-11"]);
    expect(dates("yesterday", late, "UTC")).toEqual(["2026-11-10"]);
    // 06:30 UTC on 12 Nov is still 22:30 on 11 Nov in Los Angeles
    expect(dates("yesterday", new Date("2026-11-12T06:30:00Z"), "America/Los_Angeles")).toEqual(["2026-11-10"]);
  });
  it("resolves a weekday against the local day, not the UTC day", () => {
    // Kolkata is already Thursday; "Wednesday" is yesterday there
    expect(dates("on Wednesday", new Date("2026-11-11T19:00:00Z"), "Asia/Kolkata")).toEqual(["2026-11-11"]);
  });
});

describe("nowLine", () => {
  it("prints local time, zone and weekday", () => {
    expect(nowLine(now, "Asia/Kolkata")).toBe("2026-11-11 12:58 (Asia/Kolkata), Wednesday");
  });
});
