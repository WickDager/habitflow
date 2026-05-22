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

function MoodSparkline({ moods }: { moods: MoodEntry[] }) {
  const { t } = useLanguage();
  const points = moods.slice(0, 7).reverse();
  if (points.length < 2) return null;

  const w = 120;
  const h = 40;
  const padding = 4;
  const stepX = (w - padding * 2) / (points.length - 1);

  const yForMood = (m: number) =>
    padding + ((h - padding * 2) * (m - 1)) / 2;

  const d = points
    .map((p, i) => {
      const x = padding + i * stepX;
      const y = yForMood(p.mood);
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(" ");

  const fillD = `${d} L ${padding + (points.length - 1) * stepX} ${h} L ${padding} ${h} Z`;

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
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-label={t("moodTrendLabel", { summary })}
    >
      <defs>
        <linearGradient id="mood-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.2" />
          <stop
            offset="100%"
            stopColor="var(--color-primary)"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#mood-fill)" />
      <path
        d={d}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
      />
    </svg>
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
        {data.streaks.map((s) => (
          <div key={s.habit_id} className="streak-card">
            <div className="streak-header">
              <span className="streak-icon">🔥</span>
              <AnimatedNumber value={s.total_completions ?? 0} />
              <span className="streak-unit">{t("streakDays")}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mood-section">
        <h3>{t("moodTrend")}</h3>
        <MoodSparkline moods={data.recentMoods} />
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
