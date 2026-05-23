"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import confetti from "canvas-confetti";
import { apiFetch } from "@/lib/apiFetch";
import { haptics } from "@/lib/haptics";
import {
  savePendingCheckins,
  getPendingCheckins,
  clearPendingCheckins,
  type CheckinDraft,
} from "@/lib/offlineStore";
import { useLanguage } from "@/lib/i18n";
import { HabitSkeleton } from "./HabitSkeleton";
import { EditHabitSheet } from "./EditHabitSheet";

interface Habit {
  id: string;
  name: string;
  icon: string;
}

interface Checkin {
  id?: string;
  habit_id: string;
  date: string;
  completed: boolean;
  mood?: 1 | 2 | 3;
  notes?: string;
}

interface HabitWithCheckin extends Habit {
  checkins: Checkin[];
}

type Mood = 1 | 2 | 3;

export function TodayView() {
  const { mutate } = useSWRConfig();
  const { t } = useLanguage();
  const [mood, setMood] = useState<Mood | null>(null);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [showCelebration, setShowCelebration] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  // Swipe state
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeHandled = useRef(false);

  const today = new Date().toISOString().slice(0, 10);

  const { data: habits, isLoading, error } = useSWR<HabitWithCheckin[]>(
    `/api/checkins?date=${today}`,
    apiFetch,
    {
      fallbackData: [],
      onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
        if (err.message?.includes("init data is missing")) return;
        if (retryCount >= 3) return;
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
      onSuccess: async (data) => {
        const pending = await getPendingCheckins();
        if (pending.length > 0) {
          const merged = data.map((h) => {
            const p = pending.find((p) => p.habit_id === h.id);
            if (p) {
              const checkins = h.checkins?.length
                ? [{ ...h.checkins[0], completed: p.completed }]
                : [{ habit_id: h.id, date: today, completed: p.completed }];
              return { ...h, checkins };
            }
            return h;
          });
          mutate(`/api/checkins?date=${today}`, merged, false);
        }
      },
    }
  );

  useEffect(() => {
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const isCompleted = useCallback(
    (habitId: string) => {
      const h = habits?.find((h) => h.id === habitId);
      return h?.checkins?.[0]?.completed ?? false;
    },
    [habits]
  );

  const safeHabits = useMemo(() => habits ?? [], [habits]);
  const allCompleted =
    safeHabits.length > 0 && safeHabits.every((h) => isCompleted(h.id));

  const toggleHabit = useCallback(
    async (habitId: string) => {
      const current = isCompleted(habitId);
      haptics.light();

      const optimistic = safeHabits.map((h) =>
        h.id === habitId
          ? {
              ...h,
              checkins: [
                {
                  habit_id: h.id,
                  date: today,
                  completed: !current,
                },
              ],
            }
          : h
      );

      await mutate(`/api/checkins?date=${today}`, optimistic, false);

      if (!offline) {
        try {
          await apiFetch("/api/checkins", {
            method: "POST",
            body: JSON.stringify({
              checkins: [
                { habit_id: habitId, date: today, completed: !current },
              ],
            }),
          });
          await mutate(`/api/checkins?date=${today}`);
        } catch {
          haptics.error();
          await mutate(`/api/checkins?date=${today}`);
        }
      } else {
        const pending: CheckinDraft[] = (await getPendingCheckins()) ?? [];
        const idx = pending.findIndex((p) => p.habit_id === habitId);
        if (idx >= 0) pending[idx].completed = !current;
        else
          pending.push({
            habit_id: habitId,
            date: today,
            completed: !current,
          });
        await savePendingCheckins(pending);
      }
    },
    [isCompleted, mutate, offline, safeHabits, today]
  );

  useEffect(() => {
    if (allCompleted && habits && habits.length > 0) {
      haptics.success();
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setShowCelebration(true);
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { x: 0.5, y: 0.5 },
        colors: ["#5b6ef5", "#e8b86d", "#5fcfa8"],
      });
      const timer = setTimeout(() => setShowCelebration(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [allCompleted, habits]);

  const deleteHabit = useCallback(
    async (habitId: string) => {
      haptics.medium();
      const optimistic = safeHabits.filter((h) => h.id !== habitId);
      await mutate(`/api/checkins?date=${today}`, optimistic, false);
      try {
        await apiFetch(`/api/habits/${habitId}`, { method: "DELETE" });
        await mutate(`/api/checkins?date=${today}`);
        await mutate("/api/checkins/stats");
      } catch {
        haptics.error();
        await mutate(`/api/checkins?date=${today}`);
      }
    },
    [mutate, safeHabits, today]
  );

  const saveAll = async () => {
    setSaving(true);
    try {
      const checkins: CheckinDraft[] = safeHabits.map((h) => ({
        habit_id: h.id,
        date: today,
        completed: isCompleted(h.id),
        mood: mood ?? undefined,
      }));

      await apiFetch("/api/checkins", {
        method: "POST",
        body: JSON.stringify({ checkins }),
      });

      haptics.success();
      await clearPendingCheckins();
    } catch {
      haptics.error();
      window.Telegram?.WebApp?.showAlert(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const moodOptions: { value: Mood; labelKey: string; emoji: string }[] = [
    { value: 1, labelKey: "moodHappy", emoji: "😊" },
    { value: 2, labelKey: "moodNeutral", emoji: "😐" },
    { value: 3, labelKey: "moodSad", emoji: "😞" },
  ];

  if (error)
    return (
      <div className="error-state" role="alert">
        {t("loadingError")}
      </div>
    );

  return (
    <div className="today-view">
      {offline && (
        <div className="offline-banner" role="alert">
          {t("offlineBanner")}
        </div>
      )}

      {isLoading ? (
        <HabitSkeleton count={4} />
      ) : showCelebration ? (
        <div className="celebration">{t("celebration")}</div>
      ) : (
        <>
          <ul className="habit-list">
            {habits?.map((habit) => (
              <li
                key={habit.id}
                className="habit-row"
                onTouchStart={(e) => {
                  touchStartX.current = e.touches[0].clientX;
                  touchStartY.current = e.touches[0].clientY;
                  swipeHandled.current = false;
                }}
                onTouchMove={(e) => {
                  if (swipeHandled.current) return;
                  const dx = e.touches[0].clientX - touchStartX.current;
                  const dy = e.touches[0].clientY - touchStartY.current;
                  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                    swipeHandled.current = true;
                    if (dx < -40) deleteHabit(habit.id);
                  }
                }}
              >
                <button
                  className="habit-info-btn"
                  onClick={() => setEditingHabit(habit)}
                  aria-label={`${t("editHabit")}: ${habit.name}`}
                  style={{ minHeight: 44 }}
                >
                  <span className="habit-icon">{habit.icon}</span>
                  <span
                    className={`habit-name ${
                      isCompleted(habit.id) ? "completed" : ""
                    }`}
                  >
                    {habit.name}
                  </span>
                </button>
                <button
                  role="checkbox"
                  aria-checked={isCompleted(habit.id)}
                  aria-label={`${habit.name}: ${
                    isCompleted(habit.id)
                      ? t("habitCompletedLabel")
                      : t("habitNotCompletedLabel")
                  }`}
                  className={`habit-checkbox ${
                    isCompleted(habit.id) ? "checked" : ""
                  }`}
                  onClick={() => toggleHabit(habit.id)}
                  style={{ minHeight: 44, minWidth: 44 }}
                >
                  {isCompleted(habit.id) ? "✓" : ""}
                </button>
              </li>
            ))}
          </ul>

          <div className="mood-picker">
            <span className="mood-label">{t("moodLabel")}</span>
            <div className="mood-options">
              {moodOptions.map((m) => (
                <button
                  key={m.value}
                  aria-label={t(m.labelKey)}
                  className={`mood-btn ${mood === m.value ? "selected" : ""}`}
                  onClick={() => {
                    haptics.select();
                    setMood(m.value);
                  }}
                  style={{ minHeight: 56, minWidth: 56 }}
                >
                  {m.emoji}
                </button>
              ))}
            </div>
          </div>

          <button
            className="save-btn"
            onClick={saveAll}
            disabled={saving}
            style={{ minHeight: 44 }}
          >
            {saving ? t("saving") : t("saveCheckin")}
          </button>
        </>
      )}

      <EditHabitSheet
        habit={editingHabit}
        onClose={() => setEditingHabit(null)}
      />
    </div>
  );
}
