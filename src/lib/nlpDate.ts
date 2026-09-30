import { addDays, parseDateString, todayLocal, toDateString } from "./dates";

/**
 * Deterministic natural-language parsing for quick task entry.
 *
 * Deliberately not an LLM: relative dates, weekday names, times, `!priority`
 * and `#tags` cover the overwhelming majority of real input, run instantly,
 * cost nothing, and behave identically on the client and in the bot webhook.
 *
 * Pure and environment-agnostic — no DOM, no Intl timezone names beyond the
 * caller's own locale — so `POST /api/todos` and the bot's `/add` can both use
 * it and produce the same result.
 */

export interface ParsedInput {
  title: string;
  dueDate?: string;
  dueTime?: string;
  priority?: number;
  tags?: string[];
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Tidy the leftovers: stray separators, doubled spaces, dangling prepositions. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s*[,;]+\s*/g, " ")
    .replace(/\b(at|on|by|due|the)\s*$/i, "")
    .replace(/^\s*(at|on|by|due|to)\s+/i, "")
    .replace(/^[\s\-–—,;:]+|[\s\-–—,;:]+$/g, "")
    .trim();
}

export function parseTaskInput(input: string, now: Date = new Date()): ParsedInput {
  let working = ` ${input} `;
  const result: ParsedInput = { title: input.trim() };

  // ── !1 .. !3 priority ──
  const prio = working.match(/(?:^|\s)!([1-3])(?=\s|$)/);
  if (prio) {
    result.priority = Number(prio[1]);
    working = working.replace(prio[0], " ");
  }

  // ── #tags ──
  const tags: string[] = [];
  working = working.replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_m, tag: string) => {
    tags.push(tag.toLowerCase());
    return " ";
  });
  if (tags.length) result.tags = [...new Set(tags)];

  const today = todayLocal(now);
  let dueDate: string | undefined;

  // ── explicit date, highest confidence first ──
  const isoMatch = working.match(/(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/);
  const slashMatch = working.match(/(?:^|\s)(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?=\s|$)/);
  const relMatch = working.match(/\bin\s+(\d{1,3})\s*(day|days|week|weeks|month|months)\b/i);
  const weekdayMatch = working.match(
    /\b(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)\b/i
  );

  if (isoMatch) {
    dueDate = isoMatch[1];
    working = working.replace(isoMatch[0], " ");
  } else if (/\btomorrow\b/i.test(working)) {
    dueDate = addDays(today, 1);
    working = working.replace(/\btomorrow\b/i, " ");
  } else if (/\bday after tomorrow\b/i.test(working)) {
    dueDate = addDays(today, 2);
    working = working.replace(/\bday after tomorrow\b/i, " ");
  } else if (/\btoday\b/i.test(working)) {
    dueDate = today;
    working = working.replace(/\btoday\b/i, " ");
  } else if (relMatch) {
    const n = Number(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    const days = unit.startsWith("day") ? n : unit.startsWith("week") ? n * 7 : n * 30;
    dueDate = addDays(today, days);
    working = working.replace(relMatch[0], " ");
  } else if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch[2].toLowerCase()];
    const current = now.getDay();
    let delta = (target - current + 7) % 7;
    // Said on that same weekday, always mean the coming one.
    if (delta === 0) delta = 7;
    // "next monday" is treated as the next occurrence, exactly like "monday".
    // The stricter "the week after the coming one" reading turns into a
    // surprising 8-day jump when said the day before, which is worse.
    dueDate = addDays(today, delta);
    working = working.replace(weekdayMatch[0], " ");
  } else if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const yearPart = slashMatch[3];
    const year = yearPart
      ? yearPart.length === 2
        ? 2000 + Number(yearPart)
        : Number(yearPart)
      : now.getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      // Bare day/month in the past almost always means next year.
      dueDate = !yearPart && candidate < today ? `${year + 1}-${candidate.slice(5)}` : candidate;
      working = working.replace(slashMatch[0], " ");
    }
  }

  // ── time ──
  let dueTime: string | undefined;
  const explicitTime = working.match(
    /\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b/i
  );
  const hourOnly = working.match(/\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i);
  const wordTime = working.match(/\b(noon|midday|midnight|tonight)\b/i);

  if (explicitTime) {
    let h = Number(explicitTime[1]);
    const m = Number(explicitTime[2]);
    const suffix = explicitTime[3]?.toLowerCase();
    if (suffix === "pm" && h < 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
    if (h < 24 && m < 60) {
      dueTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      working = working.replace(explicitTime[0], " ");
    }
  } else if (hourOnly) {
    let h = Number(hourOnly[1]);
    const suffix = hourOnly[2].toLowerCase();
    if (suffix === "pm" && h < 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
    if (h < 24) {
      dueTime = `${String(h).padStart(2, "0")}:00`;
      working = working.replace(hourOnly[0], " ");
    }
  } else if (wordTime) {
    const word = wordTime[1].toLowerCase();
    dueTime = word === "midnight" ? "00:00" : word === "tonight" ? "20:00" : "12:00";
    working = working.replace(wordTime[0], " ");
  }

  // A time with no date means today, and rolls to tomorrow if already passed.
  if (dueTime && !dueDate) {
    const [h, m] = dueTime.split(":").map(Number);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    dueDate = nowMinutes > h * 60 + m ? addDays(today, 1) : today;
  }

  const cleaned = cleanTitle(working);
  // Never return an empty title — fall back to the original text.
  result.title = cleaned || input.trim();
  if (dueDate) result.dueDate = dueDate;
  if (dueTime) result.dueTime = dueTime;
  return result;
}

/**
 * Human label for a due date, e.g. "Today", "Tomorrow", "Fri 3 Oct".
 *
 * Pass `i18n` to get translated relative labels and a locale-formatted date —
 * without it this returns English, which is what a Russian user would
 * otherwise see for "Tomorrow" and for the month name.
 */
export function describeDueDate(
  date: string,
  now: Date = new Date(),
  i18n?: { t: (key: string) => string; locale?: string }
): string {
  const today = todayLocal(now);
  const relative =
    date === today
      ? "dateToday"
      : date === addDays(today, 1)
        ? "dateTomorrow"
        : date === addDays(today, -1)
          ? "dateYesterday"
          : null;

  if (relative) {
    return i18n ? i18n.t(relative) : relative.replace(/^date/, "");
  }

  const d = parseDateString(date);
  return d.toLocaleDateString(i18n?.locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export { toDateString };
