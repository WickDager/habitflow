"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { useLanguage } from "@/lib/i18n";
import { HabitSkeleton } from "./HabitSkeleton";

interface StreakData {
  habit_id: string;
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
    const d = new Date(p.date);
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

export function StatsView() {
  const { t } = useLanguage();
  const { data, isLoading, error } = useSWR<StatsResponse>(
    "/api/checkins/stats",
    apiFetch,
    {
      onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
        if (err.message?.includes("init data is missing")) return;
        if (retryCount >= 3) return;
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
    }
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
    (s) => (s.total_completions ?? 0) > 0
  );
  const bestStreak =
    activeStreaks.length > 0
      ? Math.max(...activeStreaks.map((s) => s.total_completions ?? 0))
      : 0;
  const totalCheckins = activeStreaks.reduce(
    (sum, s) => sum + (s.total_completions ?? 0),
    0
  );

  const totalWeekly = data.weekly.length;
  const completedWeekly = data.weekly.filter((w) => w.completed).length;
  const weeklyPct =
    totalWeekly > 0 ? Math.round((completedWeekly / totalWeekly) * 100) : 0;
  const isPerfectWeek = totalWeekly > 0 && completedWeekly === totalWeekly;

  return (
    <div className="stats-view">
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
