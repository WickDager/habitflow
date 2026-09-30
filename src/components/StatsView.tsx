"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { type SWRConfiguration } from "swr";
import { apiFetch, getInitData, ApiError } from "@/lib/apiFetch";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { errorMessage } from "@/lib/errors";
import { parseDateString } from "@/lib/dates";
import { HabitSkeleton } from "./HabitSkeleton";
import { StreakProtection } from "./StreakProtection";
import { Heatmap } from "./Heatmap";
// Type-only: keeps next/og (which the report module imports at runtime) out of
// the client bundle while still sharing one definition of the payload.
import type { InsightsResponse } from "@/lib/reportImage";

// Mirrors the habit_streaks row shape in src/lib/database.types.ts.
// This used to read only current_streak: the v2 materialized view's
// total_completions was dropped by supabase-schema.sql when it created the v3
// table, so the "total check-ins" card summed current_streak and rendered
// nonsense. Both columns exist now and mean what they say, so the two cards
// read one column each.
interface StreakData {
  habit_id: string;
  current_streak: number;
  total_completions: number;
  last_completed: string;
}

interface MoodEntry {
  habit_id: string;
  mood: 1 | 2 | 3;
  date: string;
}

interface WeeklyEntry {
  habit_id: string;
  completed: boolean;
  date: string;
}

interface StatsResponse {
  streaks: StreakData[];
  recentMoods: MoodEntry[];
  weekly: WeeklyEntry[];
}

/** How far back the insights grid looks — five weeks, i.e. the heatmap size. */
const INSIGHTS_DAYS = 35;

/** Matches the private constant in src/lib/apiFetch.ts. */
const SESSION_STORAGE_KEY = "habitflow_session";
const SESSION_HEADER = "x-session-token";

const SWR_OPTIONS: SWRConfiguration = {
  onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
    if (err.message?.includes("init data is missing")) return;
    if (retryCount >= 3) return;
    setTimeout(() => revalidate({ retryCount }), 5000);
  },
};

function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const startTime = performance.now();
    const duration = 600;
    const frame = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      el.textContent = Math.floor(value * progress).toString();
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [value]);

  return <span ref={ref}>0</span>;
}

const MOOD_EMOJI: Record<number, string> = { 1: "😊", 2: "😐", 3: "😞" };

function aggregateMoodsByDay(moods: MoodEntry[]): MoodEntry[] {
  const map = new Map<string, MoodEntry>();
  for (const m of moods) {
    if (!map.has(m.date)) map.set(m.date, m);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function MoodChart({ moods }: { moods: MoodEntry[] }) {
  const { t } = useLanguage();
  const points = aggregateMoodsByDay(moods);
  if (points.length === 0) {
    return <p className="mood-empty">{t("noMoodData")}</p>;
  }

  const padLeft = 28;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 24;
  const w = 360;
  const h = 140;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  const xForIndex = (i: number) =>
    padLeft + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2);
  const yForMood = (m: number) => padTop + ((m - 1) / 2) * chartH;

  const lineD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i)} ${yForMood(p.mood)}`)
    .join(" ");

  const dayNames = points.map((p) => {
    const d = parseDateString(p.date);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  });

  const labels: Record<number, string> = {
    1: t("moodDescHappy"),
    2: t("moodDescNeutral"),
    3: t("moodDescSad"),
  };
  const summary = points
    .map((p) => `${p.date}: ${labels[p.mood] ?? p.mood}`)
    .join(", ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mood-chart"
      aria-label={t("moodTrendLabel", { summary })}
      role="img"
    >
      {/* Grid lines */}
      {[1, 2, 3].map((mood) => (
        <line
          key={mood}
          x1={padLeft}
          y1={yForMood(mood)}
          x2={w - padRight}
          y2={yForMood(mood)}
          stroke="var(--color-border)"
          strokeWidth="0.5"
          strokeDasharray="3 3"
        />
      ))}

      {/* Y-axis labels */}
      {[1, 2, 3].map((mood) => (
        <text
          key={mood}
          x={padLeft - 6}
          y={yForMood(mood) + 5}
          textAnchor="end"
          fontSize="14"
        >
          {MOOD_EMOJI[mood]}
        </text>
      ))}

      {/* Line */}
      {points.length >= 2 && (
        <path
          d={lineD}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Data points */}
      {points.map((p, i) => (
        <text
          key={`${p.date}-${p.habit_id}`}
          x={xForIndex(i)}
          y={yForMood(p.mood) + 5}
          textAnchor="middle"
          fontSize="16"
          className="mood-dot"
        >
          {MOOD_EMOJI[p.mood]}
        </text>
      ))}

      {/* X-axis labels */}
      {points.length > 1 &&
        points.map((p, i) => (
          <text
            key={`d-${p.date}`}
            x={xForIndex(i)}
            y={h - 4}
            textAnchor="middle"
            fontSize="10"
            fill="var(--color-muted)"
          >
            {dayNames[i]}
          </text>
        ))}
    </svg>
  );
}

function MoodBreakdown({ moods }: { moods: MoodEntry[] }) {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  const seen = new Set<string>();
  for (const m of moods) {
    if (!seen.has(m.date)) {
      seen.add(m.date);
      counts[m.mood] = (counts[m.mood] || 0) + 1;
    }
  }
  const total = counts[1] + counts[2] + counts[3];
  if (total === 0) return null;

  const moodBarClass: Record<number, string> = {
    1: "happy",
    2: "neutral",
    3: "sad",
  };

  return (
    <div className="mood-breakdown">
      {[1, 2, 3].map((mood) => {
        const pct = total > 0 ? Math.round((counts[mood] / total) * 100) : 0;
        return (
          <div key={mood} className="mood-breakdown-item">
            <span className="mood-breakdown-emoji">{MOOD_EMOJI[mood]}</span>
            <div className="mood-breakdown-bar-track">
              <div
                className={`mood-breakdown-bar ${moodBarClass[mood]}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="mood-breakdown-pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One row of "mood by completion".
 *
 * Mood is stored as 1 = happy, 2 = neutral, 3 = sad — the number runs the
 * opposite way to how it reads, so a raw average is a trap ("1.4" looks worse
 * than "2.0"). Two things fix that here: the bar length is the *inverted* value
 * (a longer bar is always a happier mood) and the number is replaced by the
 * emoji plus the word, so nobody has to know the scale to read the row.
 */
function MoodCompletionRow({ label, avg }: { label: string; avg: number | null }) {
  const { t } = useLanguage();
  const mood = avg === null ? null : Math.min(3, Math.max(1, Math.round(avg)));
  // (3 - mood) / 2 maps 1 → 100%, 2 → 50%, 3 → 0%.
  const pct = avg === null ? 0 : Math.round(((3 - avg) / 2) * 100);
  const word =
    mood === 1
      ? t("moodDescHappy")
      : mood === 2
        ? t("moodDescNeutral")
        : mood === 3
          ? t("moodDescSad")
          : null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>
          {label}
        </span>
        <span
          style={{ fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {mood === null ? "—" : `${MOOD_EMOJI[mood]} ${word}`}
        </span>
      </div>
      <div
        className="mood-breakdown-bar-track"
        role="img"
        aria-label={
          mood === null ? `${label}: —` : `${label}: ${word}, ${avg} / 3`
        }
      >
        <div
          className="mood-breakdown-bar"
          style={{ width: `${pct}%`, background: "var(--color-primary)" }}
        />
      </div>
    </div>
  );
}

/**
 * Fetches the report PNG.
 *
 * `apiFetch` always parses JSON, so it cannot carry an image; this mirrors its
 * header set instead (init data, session token, timezone) and writes back the
 * refreshed session token the same way.
 */
async function fetchReportBlob(): Promise<Blob> {
  const initData = getInitData();
  let sessionToken: string | undefined;
  try {
    sessionToken = localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    /* private mode — there is simply no stored token */
  }
  if (!initData && !sessionToken) throw new Error("NOT_IN_TELEGRAM");

  const headers: Record<string, string> = {};
  if (initData) headers["x-telegram-init-data"] = initData;
  if (sessionToken) headers[SESSION_HEADER] = sessionToken;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) headers["x-timezone"] = tz;
  } catch {
    /* keep the request going without a timezone */
  }

  const res = await fetch("/api/report?format=image", { headers });
  const refreshed = res.headers.get(SESSION_HEADER);
  if (refreshed) {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, refreshed);
    } catch {
      /* storage disabled */
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "API_ERROR", !!body.reopen);
  }
  return res.blob();
}

export function StatsView() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);

  const { data, isLoading, error } = useSWR<StatsResponse>(
    "/api/checkins/stats",
    apiFetch,
    SWR_OPTIONS
  );

  const { data: insights, error: insightsError } = useSWR<InsightsResponse>(
    `/api/insights?days=${INSIGHTS_DAYS}`,
    apiFetch,
    SWR_OPTIONS
  );

  if (isLoading) return <HabitSkeleton count={4} />;
  if (error)
    return (
      <div className="error-state" role="alert">
        {t("statsError")}
      </div>
    );
  if (!data) return null;

  const activeStreaks = (data.streaks ?? []).filter(
    (s) => (s.current_streak ?? 0) > 0
  );
  const bestStreak =
    activeStreaks.length > 0
      ? Math.max(...activeStreaks.map((s) => s.current_streak ?? 0))
      : 0;
  // All-time completions, straight from the column that holds them.
  const totalCheckins = (data.streaks ?? []).reduce(
    (sum, s) => sum + (s.total_completions ?? 0),
    0
  );

  const totalWeekly = data.weekly.length;
  const completedWeekly = data.weekly.filter((w) => w.completed).length;
  const weeklyPct =
    totalWeekly > 0 ? Math.round((completedWeekly / totalWeekly) * 100) : 0;
  const isPerfectWeek = totalWeekly > 0 && completedWeekly === totalWeekly;

  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  // "Enough data" means the window holds at least one completion or one logged
  // mood. Anything less and the grid would just be a blank chart.
  const hasInsights =
    !!insights &&
    (insights.heatmap.some((d) => d.count > 0) ||
      insights.moodByCompletion.completedAvg !== null ||
      insights.moodByCompletion.missedAvg !== null);

  const completionPct =
    insights && insights.heatmap.length > 0
      ? Math.round(
          Math.min(
            1,
            insights.heatmap.reduce((s, d) => s + d.count, 0) /
              Math.max(
                1,
                insights.heatmap.reduce((s, d) => s + d.total, 0)
              )
          ) * 100
        )
      : 0;

  // 2024-01-07 was a Sunday, so 0..6 maps to Sunday-first without ISO strings.
  const bestWeekdayName =
    insights?.bestWeekday === null || insights?.bestWeekday === undefined
      ? null
      : new Date(2024, 0, 7 + insights.bestWeekday, 12).toLocaleDateString(
          locale,
          { weekday: "long" }
        );

  async function shareReport() {
    setSharing(true);
    try {
      const blob = await fetchReportBlob();
      const file = new File([blob], "habitflow-week.png", { type: "image/png" });

      // Telegram Web has no Web Share API, so this is a bonus path, not the
      // only one.
      if (
        typeof navigator.canShare === "function" &&
        typeof navigator.share === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({ files: [file], title: t("reportTitle") });
        return;
      }

      // Fallback: a blob URL. Linking straight to /api/report would arrive
      // without the init-data headers and 401.
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!opened) throw new Error("POPUP_BLOCKED");
    } catch (err) {
      // Dismissing the share sheet is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="stats-view">
      {/* Renders nothing unless a live streak is unprotected today. */}
      <StreakProtection />
      <div className="streak-grid">
        {activeStreaks.length === 0 && totalCheckins === 0 ? (
          <div className="streak-card" style={{ gridColumn: "1 / -1" }}>
            <div className="empty-state" style={{ padding: "var(--space-md) 0" }}>
              <span className="empty-state-emoji" style={{ fontSize: "2.5rem" }}>🔥</span>
              <span className="empty-state-text">{t("noStreaksYet")}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="streak-card">
              <span className="streak-emoji">🔥</span>
              <span className="streak-number">
                <AnimatedNumber value={bestStreak} />
              </span>
              <span className="streak-label">{t("bestStreak")}</span>
            </div>
            <div className="streak-card">
              <span className="streak-emoji">🏆</span>
              <span className="streak-number">
                <AnimatedNumber value={totalCheckins} />
              </span>
              <span className="streak-label">{t("totalCheckins")}</span>
            </div>
          </>
        )}
      </div>

      {insightsError ? null : hasInsights && insights ? (
        <>
          <p className="section-label">{t("insights")}</p>

          <div className="stats-card">
            <h2 className="stats-card-title">{t("heatmapTitle")}</h2>
            <Heatmap days={insights.heatmap} />
          </div>

          <div className="streak-grid">
            <div className="streak-card">
              <span className="streak-emoji">🎯</span>
              <span className="streak-number">
                <AnimatedNumber value={completionPct} />%
              </span>
              <span className="streak-label">{t("completionRate")}</span>
            </div>
            <div className="streak-card">
              <span className="streak-emoji">📅</span>
              <span className="streak-number" style={{ fontSize: "1.15rem" }}>
                {bestWeekdayName ?? "—"}
              </span>
              <span className="streak-label">{t("bestDayLabel")}</span>
            </div>
          </div>

          <div className="stats-card">
            <h2 className="stats-card-title">{t("moodByCompletion")}</h2>
            <div className="mood-breakdown">
              <MoodCompletionRow
                label={t("moodOnCompleteDays")}
                avg={insights.moodByCompletion.completedAvg}
              />
              <MoodCompletionRow
                label={t("moodOnMissedDays")}
                avg={insights.moodByCompletion.missedAvg}
              />
            </div>
          </div>

          <button
            type="button"
            className="save-btn"
            onClick={shareReport}
            disabled={sharing}
          >
            {sharing ? t("saving") : t("share")}
          </button>
        </>
      ) : (
        <p className="muted-text">{t("noInsightsYet")}</p>
      )}

      <div className="stats-card">
        <h2 className="stats-card-title">{t("moodTrend")}</h2>
        <MoodChart moods={data.recentMoods} />
        <p className="section-label" style={{ marginTop: 16, marginBottom: 8 }}>{t("moodBreakdown")}</p>
        <MoodBreakdown moods={data.recentMoods} />
      </div>

      <div className="stats-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className="stats-card-title" style={{ margin: 0 }}>{t("thisWeek")}</h2>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-primary)" }}>
            {completedWeekly} <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>{t("outOf")}</span> {totalWeekly}
          </span>
        </div>
        <div
          className="progress-bar"
          style={{ height: 16 }}
          role="progressbar"
          aria-valuenow={completedWeekly}
          aria-valuemin={0}
          aria-valuemax={totalWeekly}
        >
          <div
            className="progress-fill progress-fill-striped"
            style={{ width: `${weeklyPct}%` }}
          />
        </div>
        {isPerfectWeek && (
          <p className="progress-label" style={{ marginTop: 8, fontWeight: 600, color: "var(--color-mood-happy)" }}>
            {t("perfectWeek")}
          </p>
        )}
      </div>
    </div>
  );
}
