import * as chrono from "chrono-node";
import { localDate, wallClock } from "./clock.js";

export interface ResolvedDate {
  phrase: string;
  date: string; // YYYY-MM-DD in the request timezone
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Users refer back to things already said, so a bare weekday or a day-month
// without a year means the most recent such day, never a future one.
export function resolveDates(message: string, now: Date, tz: string): ResolvedDate[] {
  const ref = wallClock(now, tz);
  const today = localDate(now, tz);
  const out: ResolvedDate[] = [];

  for (const r of chrono.parse(message, { instant: ref, timezone: 0 })) {
    const s = r.start;
    if (!s.isCertain("day") && !s.isCertain("weekday") && !s.isCertain("month")) continue;
    let d = new Date(Date.UTC(s.get("year")!, s.get("month")! - 1, s.get("day")!));
    if (iso(d) > today && !s.isCertain("year")) {
      if (s.isCertain("month")) d.setUTCFullYear(d.getUTCFullYear() - 1);
      else if (s.isCertain("weekday")) d.setUTCDate(d.getUTCDate() - 7);
    }
    out.push({ phrase: r.text, date: iso(d) });
    // "last Tuesday" said on a Wednesday can mean yesterday or a week earlier.
    // Return both and let retrieval look at each day.
    if (/^last\s+(mon|tues|wednes|thurs|fri|satur|sun)day$/i.test(r.text) && s.isCertain("weekday")) {
      const earlier = new Date(d);
      earlier.setUTCDate(earlier.getUTCDate() - 7);
      if (iso(earlier) !== iso(d)) out.push({ phrase: r.text, date: iso(earlier) });
    }
  }
  return out;
}
