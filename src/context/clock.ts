export function serverTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Falls back to the server's zone when the client sends nothing usable.
export function resolveTz(tz?: string): string {
  return tz && isValidTz(tz) ? tz : serverTz();
}

export function localParts(instant: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "long",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: p.weekday as string,
  };
}

export function localDate(instant: Date, tz: string): string {
  return localParts(instant, tz).date;
}

// A Date whose UTC fields equal the local wall clock in tz. chrono-node only
// takes offsets, so we hand it this and read calendar fields back.
export function wallClock(instant: Date, tz: string): Date {
  const { date, time } = localParts(instant, tz);
  return new Date(`${date}T${time}:00Z`);
}

export function nowLine(instant: Date, tz: string): string {
  const { date, time, weekday } = localParts(instant, tz);
  return `${date} ${time} (${tz}), ${weekday}`;
}
