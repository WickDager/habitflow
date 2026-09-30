/**
 * Weekly report: one home for the insight maths and the shareable card.
 *
 * Both `/api/insights` and `/api/report` build their numbers here, so the
 * heatmap the user sees in the app and the PNG they send to a friend can never
 * disagree. The JSX card is rendered with `ImageResponse` (next/og).
 *
 * Rendering constraints worth remembering before editing the card:
 *  - Satori only does flexbox. Every element with more than one child gets an
 *    explicit `display: "flex"`; there is no grid.
 *  - Fonts: the Node build of next/og loads a single bundled face
 *    (`Geist-Regular.ttf`) with fs.readFileSync and no network call. We do NOT
 *    pass `fonts`, so nothing is fetched from Google Fonts — the card renders
 *    on the free tier with no outbound requests.
 *  - No emoji in the card: satori resolves emoji glyphs by fetching twemoji
 *    SVGs from a CDN, which would be a network dependency (and Geist has no
 *    emoji coverage anyway). Icons are drawn as coloured shapes instead.
 *  - Bold weights fall back to the single 400 face, so hierarchy comes from
 *    size and colour, not from weight.
 */
import { ImageResponse } from "next/og";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CheckinRow,
  Database,
  HabitRow,
  HabitStreakRow,
} from "./database.types";
import { addDays, dateInTimezone, parseDateString } from "./dates";
import { en } from "./i18n/en";
import { ru } from "./i18n/ru";

// ── Localisation ──
// The card is rendered on the server, so `useLanguage()` is not available and
// the dictionary is picked from the user's stored language_code instead. The
// mapping mirrors detectInitialLanguage() in src/lib/i18n/index.tsx.
export type ReportLang = "en" | "ru";

export function resolveLang(
  languageCode: string | null | undefined
): ReportLang {
  const code = (languageCode ?? "en").toLowerCase();
  return code === "ru" || code === "uk" || code === "be" ? "ru" : "en";
}

export type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string;

const DICTS: Record<ReportLang, Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  ru: ru as unknown as Record<string, string>,
};

/** Same `{{param}}` interpolation the app's `t()` uses. */
export function translator(lang: ReportLang): Translate {
  const dict = DICTS[lang];
  return (key, params) => {
    const template = dict[key] ?? (en as Record<string, string>)[key] ?? key;
    if (!params) return template;
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_, name) => String(params[name] ?? `{{${name}}}`)
    );
  };
}

// ── Shapes ──

export interface HeatmapCell {
  date: string;
  /** Habits completed that day. */
  count: number;
  /** Habit-days that were possible that day (see possibleOn). */
  total: number;
}

export interface WeeklyPoint {
  date: string;
  completed: number;
  total: number;
}

export interface MoodByCompletion {
  /** Mean mood (1..3) on days with at least one completion, null if no data. */
  completedAvg: number | null;
  /** Mean mood (1..3) on days with no completion at all, null if no data. */
  missedAvg: number | null;
}

export interface InsightsResponse {
  heatmap: HeatmapCell[];
  /** Completed check-ins / possible habit-days over the whole window, 0..1. */
  completionRate: number;
  /** 0=Sunday..6=Saturday, null when the window has no possible habit-days. */
  bestWeekday: number | null;
  moodByCompletion: MoodByCompletion;
  /** The last 7 days of the window. */
  weekly: WeeklyPoint[];
  streaks: HabitStreakRow[];
}

export type InsightCheckin = Pick<
  CheckinRow,
  "habit_id" | "date" | "completed" | "mood"
>;

export interface InsightInputs {
  /** Every habit, archived ones included — see the note on possibleOn(). */
  habits: HabitRow[];
  /** Check-ins inside the window only. */
  checkins: InsightCheckin[];
  streaks: HabitStreakRow[];
}

// ── Loading ──

/**
 * The rows both report routes need. Kept here so `/api/insights` and
 * `/api/report` cannot drift apart in what they count.
 */
export async function loadInsightInputs(
  sb: SupabaseClient<Database>,
  userId: string,
  today: string,
  days: number
): Promise<{ data: InsightInputs | null; failed: boolean }> {
  const start = addDays(today, -(days - 1));

  const [habitsRes, checkinsRes, streaksRes] = await Promise.all([
    // Archived habits are fetched too: they are needed to keep the denominator
    // honest for the days they were still live.
    sb.from("habits").select("*").eq("user_id", userId),
    sb
      .from("checkins")
      .select("habit_id, date, completed, mood")
      .eq("user_id", userId)
      .gte("date", start)
      .lte("date", today),
    sb.from("habit_streaks").select("*").eq("user_id", userId),
  ]);

  if (habitsRes.error || checkinsRes.error || streaksRes.error) {
    return { data: null, failed: true };
  }

  return {
    data: {
      habits: habitsRes.data ?? [],
      checkins: checkinsRes.data ?? [],
      streaks: streaksRes.data ?? [],
    },
    failed: false,
  };
}

// ── The maths ──

/**
 * How many habits could have been checked off on `day`.
 *
 * A habit counts from the day it was created until the day it was archived
 * (both inclusive, both read in the user's timezone). That is the honest
 * denominator: a habit added yesterday must not make last week look like a
 * failure, and a habit archived last week must keep counting for the days it
 * was live — its check-ins are still inside the window, so dropping it would
 * let the completion rate climb past 100%.
 *
 * Archived *after* the window is the common case and behaves identically to
 * "never archived".
 */
export function computeInsights(input: {
  checkins: InsightCheckin[];
  habits: HabitRow[];
  streaks: HabitStreakRow[];
  /** The user's local calendar date — the window ends here. */
  today: string;
  /** Window length in days, ending today (inclusive). */
  days: number;
  /** IANA timezone, used to turn created_at/archived_at into local days. */
  timezone: string;
}): InsightsResponse {
  const { checkins, habits, streaks, today, days, timezone } = input;

  const windowStart = addDays(today, -(days - 1));
  const windowDates: string[] = [];
  for (let i = 0; i < days; i++) windowDates.push(addDays(windowStart, i));

  const bounds = habits.map((habit) => ({
    // created_at is a timestamptz: which calendar day that is depends on where
    // the user is, so compare local days rather than UTC ones.
    from: dateInTimezone(timezone, new Date(habit.created_at)),
    until: habit.archived_at
      ? dateInTimezone(timezone, new Date(habit.archived_at))
      : null,
  }));

  // YYYY-MM-DD strings compare correctly with < / >, so no date parsing here.
  const possibleOn = (day: string): number =>
    bounds.reduce(
      (n, b) =>
        b.from <= day && (b.until === null || b.until >= day) ? n + 1 : n,
      0
    );

  const completedByDate = new Map<string, number>();
  // One mood per day: TodayView saves a single mood for the whole bulk save and
  // copies it onto every check-in of that day, and the existing mood breakdown
  // dedupes by date the same way. Without this, a day with four habits would
  // weigh four times as much as a day with one.
  const moodByDate = new Map<string, number>();
  const dayHadCompletion = new Set<string>();

  for (const checkin of checkins) {
    // Defensive: the query is already bounded, but a caller passing a wider set
    // must not skew the window.
    if (checkin.date < windowStart || checkin.date > today) continue;
    if (checkin.completed) {
      completedByDate.set(
        checkin.date,
        (completedByDate.get(checkin.date) ?? 0) + 1
      );
      dayHadCompletion.add(checkin.date);
    }
    if (checkin.mood !== null && !moodByDate.has(checkin.date)) {
      moodByDate.set(checkin.date, checkin.mood);
    }
  }

  // Invariant: `total` is never smaller than `count`. A habit created "after" a
  // check-in on that habit (clock skew, or a created_at edited by hand) would
  // otherwise produce a ratio above 1 and a bar taller than its own track. The
  // completion itself is real, so the honest repair is to widen the denominator,
  // not to hide the check-in. Everything downstream can then assume 0..1.
  const heatmap: HeatmapCell[] = windowDates.map((date) => {
    const count = completedByDate.get(date) ?? 0;
    return { date, count, total: Math.max(count, possibleOn(date)) };
  });

  const weekly: WeeklyPoint[] = heatmap
    .slice(-7)
    .map(({ date, count, total }) => ({ date, completed: count, total }));

  const totalCompleted = heatmap.reduce((sum, d) => sum + d.count, 0);
  const totalPossible = heatmap.reduce((sum, d) => sum + d.total, 0);
  const completionRate = totalPossible > 0 ? totalCompleted / totalPossible : 0;

  // Best weekday: the weekday whose pooled completion rate across the window is
  // the highest. Ties go to the weekday with more possible habit-days (more
  // evidence), then to the earlier weekday for a stable answer.
  const perWeekday = new Map<number, { completed: number; total: number }>();
  for (const day of heatmap) {
    const weekday = parseDateString(day.date).getDay();
    const acc = perWeekday.get(weekday) ?? { completed: 0, total: 0 };
    acc.completed += day.count;
    acc.total += day.total;
    perWeekday.set(weekday, acc);
  }

  let bestWeekday: number | null = null;
  let bestRate = -1;
  let bestDays = -1;
  for (let weekday = 0; weekday < 7; weekday++) {
    const acc = perWeekday.get(weekday);
    if (!acc || acc.total === 0) continue;
    const rate = acc.completed / acc.total;
    const better =
      rate > bestRate + 1e-9 ||
      (Math.abs(rate - bestRate) <= 1e-9 && acc.total > bestDays);
    if (better) {
      bestWeekday = weekday;
      bestRate = rate;
      bestDays = acc.total;
    }
  }

  // Bucketing is per day, not per check-in: a day counts as a "completed day"
  // when at least one habit was completed on it, which is what "mood on days
  // habits were completed vs days they weren't" means to a reader.
  const completedMoods: number[] = [];
  const missedMoods: number[] = [];
  for (const [date, mood] of moodByDate) {
    if (dayHadCompletion.has(date)) completedMoods.push(mood);
    else missedMoods.push(mood);
  }

  // One decimal is as much precision as a 1..3 scale supports. Note that a
  // LOWER number is a BETTER mood here (1 happy, 2 neutral, 3 sad) — the client
  // inverts it for display so longer always means happier.
  const mean = (values: number[]): number | null =>
    values.length === 0
      ? null
      : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

  return {
    heatmap,
    completionRate,
    bestWeekday,
    moodByCompletion: {
      completedAvg: mean(completedMoods),
      missedAvg: mean(missedMoods),
    },
    weekly,
    streaks,
  };
}

// ── The card ──

export interface ReportCardData {
  lang: ReportLang;
  /** Localised "Your week in HabitFlow". */
  title: string;
  name: string;
  bestStreak: number;
  totalCheckins: number;
  weekCompleted: number;
  weekPossible: number;
  /** 0..100, for the card. */
  weekPct: number;
  /** 0..1 over the same window, matching the insights payload. */
  completionRate: number;
  weekly: WeeklyPoint[];
  rangeLabel: string;
}

/** The numbers on the card — also what `format=json` returns. */
export function buildReportCard(input: {
  insights: InsightsResponse;
  firstName: string;
  languageCode: string | null;
}): ReportCardData {
  const { insights, firstName, languageCode } = input;
  const lang = resolveLang(languageCode);
  const t = translator(lang);

  // Streak semantics live in habit_streaks: current_streak is the live run and
  // total_completions is the all-time count. Both are real columns now.
  const bestStreak = insights.streaks.reduce(
    (max, s) => Math.max(max, s.current_streak ?? 0),
    0
  );
  const totalCheckins = insights.streaks.reduce(
    (sum, s) => sum + (s.total_completions ?? 0),
    0
  );

  const weekCompleted = insights.weekly.reduce((s, d) => s + d.completed, 0);
  const weekPossible = insights.weekly.reduce((s, d) => s + d.total, 0);
  const weekPct =
    weekPossible > 0 ? Math.round((weekCompleted / weekPossible) * 100) : 0;

  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const format = (date: string) =>
    parseDateString(date).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
    });
  const first = insights.weekly[0]?.date;
  const last = insights.weekly[insights.weekly.length - 1]?.date;

  return {
    lang,
    title: t("reportTitle"),
    name: firstName,
    bestStreak,
    totalCheckins,
    weekCompleted,
    weekPossible,
    weekPct,
    completionRate: insights.completionRate,
    weekly: insights.weekly,
    rangeLabel: first && last ? `${format(first)} – ${format(last)}` : "",
  };
}

const CARD = {
  bg: "#111114",
  panel: "#1c1c22",
  text: "#ffffff",
  muted: "#9a9aa2",
  accent: "#0a84ff",
  streak: "#ff9f0a",
} as const;

function StatBlock({
  value,
  label,
  color,
  last,
}: {
  value: string;
  label: string;
  color: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        backgroundColor: CARD.panel,
        borderRadius: 28,
        padding: "32px 28px",
        marginRight: last ? 0 : 24,
      }}
    >
      <div style={{ display: "flex", fontSize: 86, color }}>{value}</div>
      <div
        style={{ display: "flex", fontSize: 27, color: CARD.muted, marginTop: 8 }}
      >
        {label}
      </div>
    </div>
  );
}

const BAR_MAX_PX = 158;

export function ReportCard({ data }: { data: ReportCardData }) {
  const t = translator(data.lang);
  const locale = data.lang === "ru" ? "ru-RU" : "en-GB";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: CARD.bg,
        color: CARD.text,
        padding: "64px 68px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            letterSpacing: 6,
            color: CARD.muted,
          }}
        >
          HABITFLOW
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 68,
            lineHeight: 1.14,
            marginTop: 26,
            fontWeight: 700,
          }}
        >
          {data.title}
        </div>

        <div style={{ display: "flex", fontSize: 42, color: CARD.muted, marginTop: 16 }}>
          {data.name}
        </div>

        {/* alignItems: stretch is explicit — it keeps the three panels the same
            height when one label wraps to two lines (Russian does). */}
        <div style={{ display: "flex", alignItems: "stretch", marginTop: 48 }}>
          <StatBlock
            value={String(data.bestStreak)}
            label={t("bestStreak")}
            color={CARD.streak}
          />
          <StatBlock
            value={String(data.totalCheckins)}
            label={t("totalCheckins")}
            color={CARD.text}
          />
          <StatBlock
            value={`${data.weekPct}%`}
            label={t("completionRate")}
            color={CARD.accent}
            last
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 22,
          }}
        >
          <div style={{ display: "flex", fontSize: 32, color: CARD.muted }}>
            {t("thisWeek")}
          </div>
          <div style={{ display: "flex", fontSize: 28, color: CARD.muted }}>
            {data.rangeLabel}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          {data.weekly.map((day, index) => {
            const ratio = day.total > 0 ? day.completed / day.total : 0;
            // A floor keeps a zero day visible as an empty track rather than a
            // bar that disappears; the ceiling keeps a bar inside its track.
            const height = Math.round(
              Math.min(1, Math.max(0.05, ratio)) * BAR_MAX_PX
            );
            const label = parseDateString(day.date).toLocaleDateString(locale, {
              weekday: "short",
            });
            return (
              <div
                key={day.date}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: 1,
                  marginRight: index === data.weekly.length - 1 ? 0 : 18,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    width: 92,
                    height: BAR_MAX_PX,
                    backgroundColor: CARD.panel,
                    borderRadius: 18,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      height,
                      backgroundColor: CARD.accent,
                      borderRadius: 18,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 26,
                    color: CARD.muted,
                    marginTop: 12,
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: CARD.muted,
            marginTop: 30,
          }}
        >
          {`${data.weekCompleted} ${t("outOf")} ${data.weekPossible}`}
        </div>
      </div>
    </div>
  );
}

/** 1080×1080 PNG, ready to hand to Telegram or `navigator.share`. */
export function renderReportImage(data: ReportCardData): ImageResponse {
  // No `fonts` option on purpose: the bundled default face is read from disk,
  // so this never touches the network.
  return new ImageResponse(<ReportCard data={data} />, {
    width: 1080,
    height: 1080,
    // The card carries a name and personal stats, and ImageResponse's own
    // default is a public cache-control. Keep it per-user.
    headers: { "cache-control": "private, no-store" },
  });
}
