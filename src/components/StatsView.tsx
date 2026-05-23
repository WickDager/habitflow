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

  return (
    <div className="mood-breakdown">
      {[1, 2, 3].map((mood) => {
        const pct = Math.round((counts[mood] / total) * 100) || 0;
        return (
          <div key={mood} className="mood-breakdown-item">
            <span className="mood-breakdown-emoji">{MOOD_EMOJI[mood]}</span>
            <div className="mood-breakdown-bar-track">
              <div
                className="mood-breakdown-bar"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="mood-breakdown-count">{counts[mood]}</span>
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

  const totalWeekly = data.weekly.length;
  const completedWeekly = data.weekly.filter((w) => w.completed).length;
  const weeklyPct =
    totalWeekly > 0 ? (completedWeekly / totalWeekly) * 100 : 0;

  return (
    <div className="stats-view">
      <div className="streak-grid">
        {data.streaks.length === 0 ? (
          <p className="muted-text">{t("noStreaksYet")}</p>
        ) : (
          data.streaks.map((s) => (
            <div key={s.habit_id} className="streak-card">
              <div className="streak-header">
                <span className="streak-icon">🔥</span>
                <AnimatedNumber value={s.total_completions ?? 0} />
                <span className="streak-unit">{t("streakDays")}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mood-section">
        <h3>{t("moodTrend")}</h3>
        <MoodChart moods={data.recentMoods} />
        <MoodBreakdown moods={data.recentMoods} />
      </div>

      <div className="weekly-section">
        <h3>{t("thisWeek")}</h3>
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuenow={completedWeekly}
          aria-valuemin={0}
          aria-valuemax={totalWeekly}
        >
          <div
            className="progress-fill"
            style={{ width: `${weeklyPct}%` }}
          />
        </div>
        <p className="progress-label">
          {t("habitsCompleted", { count: completedWeekly, total: totalWeekly })}
        </p>
      </div>
    </div>
  );
}
