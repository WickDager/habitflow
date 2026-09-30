/**
 * Local-time date helpers.
 *
 * The app used `new Date().toISOString().slice(0, 10)` for "today" in several
 * places, which is the UTC calendar day. For anyone east of UTC that is the
 * *wrong day* between local midnight and the UTC offset: check-ins land on
 * yesterday's row, and the daily list shows yesterday's completions.
 *
 * Everything here works in the caller's local calendar, or in a named IANA
 * timezone when one is supplied (the server needs this to decide what "today"
 * means for a user in another country).
 */

/** YYYY-MM-DD for a Date, using its local components (never toISOString). */
export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today in the runtime's local timezone. */
export function todayLocal(now: Date = new Date()): string {
  return toDateString(now);
}

/** Parse YYYY-MM-DD as local noon, so DST and offsets cannot shift the day. */
export function parseDateString(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function addDays(value: string, days: number): string {
  const d = parseDateString(value);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/**
 * The calendar date right now in a named IANA timezone, e.g. "Europe/Berlin".
 * Falls back to UTC when the timezone is unknown or invalid.
 */
export function dateInTimezone(tz: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return toDateString(now);
  }
}

/** The hour (0-23) right now in a named IANA timezone. */
export function hourInTimezone(tz: string, now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(now);
    const hour = Number(parts);
    return Number.isFinite(hour) ? hour % 24 : now.getHours();
  } catch {
    return now.getHours();
  }
}

/** Weekday (0=Sunday..6=Saturday) right now in a named IANA timezone. */
export function weekdayInTimezone(tz: string, now: Date = new Date()): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(now);
    const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
    return idx === -1 ? now.getDay() : idx;
  } catch {
    return now.getDay();
  }
}

/** "14:05" from an hour and minute. */
export function toTimeString(hour: number, minute = 0): string {
  return `${String(hour % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
