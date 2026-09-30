import type { ReminderKinds, UserRow } from "./database.types";
import { hourInTimezone, weekdayInTimezone, dateInTimezone } from "./dates";

/**
 * Reminder scheduling rules, shared by the tick endpoint, the settings API and
 * the weekly report. Keeping them in one place is what stops "the reminder
 * fired at the wrong hour" from becoming a per-feature bug.
 *
 * All decisions are made in the *user's* timezone, never the server's.
 */

export type ReminderKind = "morning" | "nudge" | "evening" | "weekly" | "task";

export const ALL_KINDS: ReminderKind[] = [
  "morning",
  "nudge",
  "evening",
  "weekly",
  "task",
];

export function reminderKinds(user: Pick<UserRow, "reminder_kinds">): ReminderKinds {
  const raw = user.reminder_kinds;
  if (!raw || typeof raw !== "object") return {};
  return raw as ReminderKinds;
}

export function isKindEnabled(
  user: Pick<UserRow, "reminder_kinds" | "reminder_enabled">,
  kind: ReminderKind
): boolean {
  // `task` reminders follow each task's due time and are not one of the
  // digest toggles, so the master switch and kind flags do not apply.
  if (kind === "task") return true;
  if (!user.reminder_enabled) return false;
  const kinds = reminderKinds(user);
  return kinds[kind] !== false;
}

/**
 * Quiet hours wrap past midnight (22 → 7), so a simple min/max compare is
 * wrong. Start === end is treated as "no quiet hours" rather than 24h silence.
 */
export function isQuietHour(
  user: Pick<UserRow, "quiet_hours_start" | "quiet_hours_end">,
  hour: number
): boolean {
  const start = user.quiet_hours_start;
  const end = user.quiet_hours_end;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** The local hour a given reminder kind is scheduled for. */
export function slotHourFor(user: UserRow, kind: ReminderKind): number | null {
  switch (kind) {
    case "morning":
      return user.morning_hour ?? 8;
    case "evening":
      return user.evening_hour ?? 21;
    case "nudge":
      // reminder_hour is the legacy daily-reminder hour from the v2 schema.
      return user.reminder_hour ?? 20;
    case "weekly":
      return user.evening_hour ?? 21;
    case "task":
      return null; // driven by each task's due_time, not a user setting
  }
}

export interface DueContext {
  /** The user's local calendar date, YYYY-MM-DD. */
  localDate: string;
  /** The user's local hour, 0-23. */
  localHour: number;
  /** The user's local weekday, 0=Sunday. */
  localWeekday: number;
}

export function contextFor(user: Pick<UserRow, "timezone">, now: Date = new Date()): DueContext {
  const tz = user.timezone || "UTC";
  return {
    localDate: dateInTimezone(tz, now),
    localHour: hourInTimezone(tz, now),
    localWeekday: weekdayInTimezone(tz, now),
  };
}

/** Which reminder kinds are due for this user at this moment. */
export function dueKinds(user: UserRow, now: Date = new Date()): { kind: ReminderKind; ctx: DueContext }[] {
  const ctx = contextFor(user, now);
  if (isQuietHour(user, ctx.localHour)) return [];

  const due: ReminderKind[] = [];
  for (const kind of ["morning", "nudge", "evening"] as const) {
    if (!isKindEnabled(user, kind)) continue;
    if (slotHourFor(user, kind) === ctx.localHour) due.push(kind);
  }
  // Weekly report goes out on Sunday evening, with the evening slot.
  if (
    isKindEnabled(user, "weekly") &&
    ctx.localWeekday === 0 &&
    slotHourFor(user, "weekly") === ctx.localHour
  ) {
    due.push("weekly");
  }
  return due.map((kind) => ({ kind, ctx }));
}

/**
 * The uniqueness key for one send. The scheduler runs every few minutes, so
 * this is what makes a repeated tick a no-op instead of a second message.
 */
export function dedupeKey(
  userId: string,
  kind: ReminderKind,
  localDate: string,
  discriminator?: string
): string {
  return [userId, kind, localDate, discriminator].filter(Boolean).join(":");
}

/** Local hour+minute as "HH:MM", for comparing against a task's due_time. */
export function localTimeInTimezone(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
}
