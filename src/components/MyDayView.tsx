"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import confetti from "canvas-confetti";
import { apiFetch, ApiError } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { todayLocal } from "@/lib/dates";
import { haptics } from "@/lib/haptics";
import { useToast } from "@/components/Toast";
import {
  savePendingCheckins,
  getPendingCheckins,
  clearPendingCheckins,
  type CheckinDraft,
} from "@/lib/offlineStore";
import { useLanguage } from "@/lib/i18n";
import type { TodoRow } from "@/lib/database.types";
import { HabitSkeleton } from "./HabitSkeleton";
import { EditHabitSheet } from "./EditHabitSheet";
import { FocusPicker } from "./FocusPicker";
import styles from "./MyDayView.module.css";

/**
 * My Day — one list of everything today holds.
 *
 * The Today tab used to show habits only, with tasks living in their own tab,
 * so the question "what do I actually have to do today?" needed two screens.
 * This merges them: focus habits pinned at the top, then tasks (overdue ones
 * marked), then the habit check-ins — all of it from a single /api/day call.
 */

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

/** A habit as /api/day returns it: today's state folded in. */
interface DayHabit extends Habit {
  completed: boolean;
  mood: number | null;
  streak: number;
  total: number;
  focused: boolean;
}

interface DayResponse {
  date: string;
  habits: DayHabit[];
  /** Open tasks due today, plus anything overdue (overdue is a subset). */
  tasks: TodoRow[];
  overdue: TodoRow[];
  focus: string[];
  rollsOverdueCount: number;
}

type Mood = 1 | 2 | 3;

/** Keep in step with FOCUS_LIMIT in /api/focus. */
const FOCUS_LIMIT = 3;

/** The check-in route caps a bulk request at 20 rows. */
const CHECKIN_BATCH = 20;

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path
        className="check-path"
        d="M3 8.5L6.5 12L13 4"
      />
    </svg>
  );
}

/** priority 0=none, 1=low, 2=medium, 3=high (see lib/schemas.ts). */
const PRIORITY_LABEL_KEY: Record<number, string> = {
  1: "priorityLow",
  2: "priorityMedium",
  3: "priorityHigh",
};

export function MyDayView() {
  const { mutate } = useSWRConfig();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [mood, setMood] = useState<Mood | null>(null);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [showCelebration, setShowCelebration] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);

  const swipeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const swipeStartX = useRef(0);
  const swipeCurrentX = useRef(0);
  const swipeActiveId = useRef<string | null>(null);
  const flushing = useRef(false);

  // The local day, never the UTC one: `toISOString().slice(0, 10)` puts an
  // evening check-in in the Americas on tomorrow's row and a morning one in
  // Asia on yesterday's.
  const today = todayLocal();
  const checkinsKey = `/api/checkins?date=${today}`;
  const dayKey = `/api/day?date=${today}`;

  const {
    data: habits,
    isLoading,
    error: checkinsError,
  } = useSWR<HabitWithCheckin[]>(checkinsKey, apiFetch, {
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
              : [{ habit_id: h.id, date: p.date, completed: p.completed }];
            return { ...h, checkins };
          }
          return h;
        });
        mutate(checkinsKey, merged, false);
      }
    },
  });

  const { data: day, error: dayError } = useSWR<DayResponse>(dayKey, apiFetch, {
    onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
      if (err.message?.includes("init data is missing")) return;
      if (retryCount >= 3) return;
      setTimeout(() => revalidate({ retryCount }), 5000);
    },
  });

  const safeHabits = useMemo(() => habits ?? [], [habits]);
  const focusIds = useMemo(() => day?.focus ?? [], [day]);
  const tasks = useMemo(() => day?.tasks ?? [], [day]);
  const overdueIds = useMemo(
    () => new Set((day?.overdue ?? []).map((task) => task.id)),
    [day]
  );

  const isCompleted = useCallback(
    (habitId: string) => {
      const h = habits?.find((h) => h.id === habitId);
      return h?.checkins?.[0]?.completed ?? false;
    },
    [habits]
  );

  const allCompleted =
    safeHabits.length > 0 && safeHabits.every((h) => isCompleted(h.id));
  const completedCount = safeHabits.filter((h) => isCompleted(h.id)).length;
  const progressPct = safeHabits.length
    ? Math.round((completedCount / safeHabits.length) * 100)
    : 0;

  const focusedHabits = useMemo(
    () => (day?.habits ?? []).filter((habit) => habit.focused),
    [day]
  );

  /**
   * Push drafts that were written while offline.
   *
   * The offline banner has always promised "changes will sync when you
   * reconnect" while nothing actually did it — the drafts only went out if the
   * user pressed Save. This is the missing half.
   */
  const flushPending = useCallback(async () => {
    if (flushing.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    let pending: CheckinDraft[] = [];
    try {
      pending = await getPendingCheckins();
    } catch {
      return; // no IndexedDB (private mode) — nothing was ever stored
    }
    if (pending.length === 0) return;

    flushing.current = true;
    try {
      // Grouped by day: the bulk route only accepts today or yesterday, so a
      // stale draft from an earlier session must not fail the whole batch on
      // behalf of the drafts that can still be saved.
      const byDate = new Map<string, CheckinDraft[]>();
      for (const draft of pending) {
        const group = byDate.get(draft.date) ?? [];
        group.push(draft);
        byDate.set(draft.date, group);
      }

      let saved = 0;
      let firstError: unknown = null;
      const unsent: CheckinDraft[] = [];

      for (const group of byDate.values()) {
        for (let i = 0; i < group.length; i += CHECKIN_BATCH) {
          const chunk = group.slice(i, i + CHECKIN_BATCH);
          try {
            await apiFetch("/api/checkins", {
              method: "POST",
              body: JSON.stringify({ checkins: chunk }),
            });
            saved += chunk.length;
          } catch (err) {
            unsent.push(...chunk);
            firstError = firstError ?? err;
          }
        }
      }

      // Anything that failed stays in the store: the draft is the only copy.
      if (unsent.length > 0) await savePendingCheckins(unsent);
      else await clearPendingCheckins();

      if (saved > 0) {
        haptics.success();
        await mutate(checkinsKey);
        await mutate(dayKey);
        toast(t("saved"), { kind: "success" });
      }
      if (firstError) {
        haptics.error();
        toast(errorMessage(firstError, t), { kind: "error" });
      }
    } catch (err) {
      haptics.error();
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      flushing.current = false;
    }
  }, [checkinsKey, dayKey, mutate, t, toast]);

  useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
      void flushPending();
    };
    const handleOffline = () => setOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushPending]);

  useEffect(() => {
    // Drafts left over from a previous session, or written before this tab
    // was reopened: try once on load rather than waiting for a reconnect
    // event that may never fire.
    void flushPending();
  }, [flushPending]);

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

      await mutate(checkinsKey, optimistic, false);

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
          await mutate(checkinsKey);
          await mutate(dayKey);
        } catch (err) {
          haptics.error();
          toast(errorMessage(err, t), { kind: "error" });
          await mutate(checkinsKey);
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
    [checkinsKey, dayKey, isCompleted, mutate, offline, safeHabits, t, today, toast]
  );

  useEffect(() => {
    if (allCompleted && habits && habits.length > 0) {
      haptics.success();
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setShowCelebration(true);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { x: 0.5, y: 0.5 },
        colors: ["#34c759", "#ff9f0a", "#2678b6", "#ff3b30"],
      });
      const timer = setTimeout(() => setShowCelebration(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [allCompleted, habits]);

  const deleteHabit = useCallback(
    async (habitId: string) => {
      haptics.medium();
      const optimistic = safeHabits.filter((h) => h.id !== habitId);
      await mutate(checkinsKey, optimistic, false);
      try {
        await apiFetch(`/api/habits/${habitId}`, { method: "DELETE" });
        await mutate(checkinsKey);
        await mutate(dayKey);
        await mutate("/api/checkins/stats");
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
        await mutate(checkinsKey);
      }
    },
    [checkinsKey, dayKey, mutate, safeHabits, t, toast]
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
      await mutate(dayKey);
      toast(t("saved"), { kind: "success" });
    } catch (err) {
      haptics.error();
      // showAlert is a no-op on Telegram Web, where most of these users are.
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  /** PATCH is_completed either way; `completed_at` is what the list reads. */
  const setTaskCompleted = useCallback(
    async (task: TodoRow, completed: boolean) => {
      await apiFetch(`/api/todos/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          is_completed: completed,
          completed_at: completed ? new Date().toISOString() : null,
        }),
      });
      await mutate(dayKey);
      await mutate("/api/todos");
    },
    [dayKey, mutate]
  );

  const completeTask = useCallback(
    async (task: TodoRow) => {
      haptics.medium();

      // Drop it from both lists at once: it is done, so it belongs in neither,
      // and leaving it until the refetch lands makes the checkbox feel stuck.
      await mutate(
        dayKey,
        (current?: DayResponse) =>
          current
            ? {
                ...current,
                tasks: current.tasks.filter((t) => t.id !== task.id),
                overdue: current.overdue.filter((t) => t.id !== task.id),
                rollsOverdueCount: current.overdue.filter(
                  (t) => t.id !== task.id
                ).length,
              }
            : current,
        false
      );

      try {
        await setTaskCompleted(task, true);
        haptics.success();
        toast(t("saved"), {
          kind: "success",
          action: {
            label: t("undo"),
            onClick: () => {
              void setTaskCompleted(task, false).catch((err) => {
                haptics.error();
                toast(errorMessage(err, t), { kind: "error" });
              });
            },
          },
        });
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
        await mutate(dayKey);
      }
    },
    [dayKey, mutate, setTaskCompleted, t, toast]
  );

  const rollOver = useCallback(
    async (ids?: string[]) => {
      haptics.medium();
      try {
        await apiFetch("/api/day", {
          method: "POST",
          body: JSON.stringify({
            action: "rollover",
            date: today,
            ...(ids ? { ids } : {}),
          }),
        });
        await mutate(dayKey);
        await mutate("/api/todos");
        haptics.success();
        toast(t("rolledOver"), { kind: "success" });
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
      }
    },
    [dayKey, mutate, t, today, toast]
  );

  const toggleFocus = useCallback(
    async (habitId: string) => {
      const pinned = focusIds.includes(habitId);
      // Answer the fourth tap here rather than with a round trip: the server
      // enforces the same cap, but the user should hear it immediately.
      if (!pinned && focusIds.length >= FOCUS_LIMIT) {
        haptics.error();
        toast(t("focusLimitReached"), { kind: "error" });
        return;
      }
      haptics.select();
      try {
        await apiFetch("/api/focus", {
          method: "POST",
          body: JSON.stringify({ habit_id: habitId, date: today }),
        });
        await mutate(dayKey);
      } catch (err) {
        haptics.error();
        toast(
          err instanceof ApiError && err.message === "FOCUS_LIMIT"
            ? t("focusLimitReached")
            : errorMessage(err, t),
          { kind: "error" }
        );
        await mutate(dayKey);
      }
    },
    [dayKey, focusIds, mutate, t, today, toast]
  );

  /**
   * Tapping a task toggles it. The real task sheet (EditTaskSheet) is owned by
   * another agent and its props are still moving, so this view does not depend
   * on it yet — the toggle is the useful half of "tap to open".
   */
  const openTask = useCallback(
    async (task: TodoRow) => {
      // TODO: open the task sheet
      await completeTask(task);
    },
    [completeTask]
  );

  const moodOptions: { value: Mood; labelKey: string; emoji: string }[] = [
    { value: 1, labelKey: "moodHappy", emoji: "😊" },
    { value: 2, labelKey: "moodNeutral", emoji: "😐" },
    { value: 3, labelKey: "moodSad", emoji: "😞" },
  ];

  const loadError = checkinsError ?? dayError;
  if (loadError)
    return (
      <div className="error-state" role="alert">
        {t("loadingError")}
      </div>
    );

  const renderTask = (task: TodoRow) => {
    const isOverdue = overdueIds.has(task.id);
    const priorityKey = PRIORITY_LABEL_KEY[task.priority];
    return (
      <li
        key={task.id}
        className={`${styles.taskRow}${isOverdue ? ` ${styles.overdueRow}` : ""}`}
      >
        <button
          className={styles.taskMain}
          onClick={() => openTask(task)}
          style={{ minHeight: 44 }}
        >
          {priorityKey ? (
            <span
              className={styles.priorityDot}
              data-priority={task.priority}
              title={t(priorityKey)}
              aria-label={t(priorityKey)}
              role="img"
            />
          ) : (
            <span className={styles.priorityNone} aria-hidden="true" />
          )}
          <span className="task-info">
            <span className="habit-name">{task.title}</span>
            <span className="task-due">
              {task.due_time ? (
                <span className="task-due-badge">🕒 {task.due_time}</span>
              ) : null}
              {isOverdue ? (
                <span className={`task-due-badge ${styles.overdueBadge}`}>
                  ⚠️ {t("overdue")}
                </span>
              ) : null}
              {task.rolled_over_count > 0 ? (
                <span className="task-due-badge">
                  ↩︎ {task.rolled_over_count}
                </span>
              ) : null}
            </span>
          </span>
        </button>

        {isOverdue ? (
          <button
            className={styles.rollBtn}
            onClick={() => rollOver([task.id])}
            aria-label={`${t("rollOver")}: ${task.title}`}
            style={{ minHeight: 44, minWidth: 44 }}
          >
            ↪
          </button>
        ) : null}

        <button
          role="checkbox"
          aria-checked={false}
          aria-label={`${task.title}: ${t("habitNotCompletedLabel")}`}
          className="habit-checkbox"
          onClick={() => completeTask(task)}
          style={{ minHeight: 44, minWidth: 44 }}
        />
      </li>
    );
  };

  return (
    <div className={`today-view ${styles.view}`}>
      {offline && (
        <div className="offline-banner" role="alert">
          {t("offlineBanner")}
        </div>
      )}

      {isLoading ? (
        <HabitSkeleton count={4} />
      ) : showCelebration ? (
        <div className="celebration">
          <span className="celebration-emoji">🎉</span>
          {t("celebration")}
        </div>
      ) : (
        <>
          {safeHabits.length > 0 ? (
            <section className={styles.focusSection}>
              <div className={styles.sectionHead}>
                <h2 className="section-label">{t("focusToday")}</h2>
                <button
                  className={styles.focusEditBtn}
                  onClick={() => setFocusOpen(true)}
                  aria-label={t("focusHint")}
                  style={{ minHeight: 44, minWidth: 44 }}
                >
                  ✎
                </button>
              </div>
              {focusedHabits.length > 0 ? (
                <ul className={styles.focusList}>
                  {focusedHabits.map((habit) => (
                    <li key={habit.id}>
                      <button
                        className={`${styles.focusChip}${
                          isCompleted(habit.id) ? ` ${styles.focusChipDone}` : ""
                        }`}
                        onClick={() => toggleHabit(habit.id)}
                        aria-label={`${habit.name}: ${
                          isCompleted(habit.id)
                            ? t("habitCompletedLabel")
                            : t("habitNotCompletedLabel")
                        }`}
                        style={{ minHeight: 44 }}
                      >
                        <span aria-hidden="true">{habit.icon}</span>
                        <span className={styles.focusChipName}>
                          {habit.name}
                        </span>
                        {habit.streak > 0 ? (
                          <span className={styles.focusChipStreak}>
                            🔥 {habit.streak}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.focusEmpty}>{t("focusHint")}</p>
              )}
            </section>
          ) : null}

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className="section-label">{t("tasksSection")}</h2>
              {day && day.rollsOverdueCount > 0 ? (
                <button
                  className={styles.rollAllBtn}
                  onClick={() => rollOver()}
                  style={{ minHeight: 44 }}
                >
                  ↪ {t("rollOverAll")}
                </button>
              ) : null}
            </div>

            {tasks.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-emoji">🗒️</span>
                <span className="empty-state-text">{t("emptyTasksTeach")}</span>
              </div>
            ) : (
              <ul className={styles.taskList}>{tasks.map(renderTask)}</ul>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className="section-label">{t("habitsSection")}</h2>
              {safeHabits.length > 0 ? (
                <span className={styles.progressLabel}>
                  {t("habitsCompleted", {
                    count: completedCount,
                    total: safeHabits.length,
                    pct: progressPct,
                  })}
                </span>
              ) : null}
            </div>

            {safeHabits.length > 0 ? (
              <div
                className={`progress-bar ${styles.progress}`}
                role="progressbar"
                aria-valuenow={completedCount}
                aria-valuemin={0}
                aria-valuemax={safeHabits.length}
                aria-label={t("habitsSection")}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            ) : null}

            {safeHabits.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-emoji">🌱</span>
                <span className="empty-state-text">{t("noHabitsYet")}</span>
              </div>
            ) : (
              <>
                <ul className="habit-list">
                  {safeHabits.map((habit) => (
                    <li key={habit.id} className="swipe-wrapper">
                      <div
                        className="swipe-delete-bg"
                        onClick={() => deleteHabit(habit.id)}
                      >
                        {t("delete")}
                      </div>
                      <div
                        className="habit-row"
                        ref={(el) => {
                          if (el) swipeRefs.current.set(habit.id, el);
                        }}
                        onTouchStart={(e) => {
                          swipeStartX.current = e.touches[0].clientX;
                          swipeActiveId.current = habit.id;
                        }}
                        onTouchMove={(e) => {
                          if (swipeActiveId.current !== habit.id) return;
                          let diff = e.touches[0].clientX - swipeStartX.current;
                          if (diff > 0) diff = 0;
                          if (diff < -100) diff = -100;
                          swipeCurrentX.current = diff;
                          const el = swipeRefs.current.get(habit.id);
                          if (el) el.style.transform = `translateX(${diff}px)`;
                        }}
                        onTouchEnd={() => {
                          if (swipeActiveId.current !== habit.id) return;
                          swipeActiveId.current = null;
                          const el = swipeRefs.current.get(habit.id);
                          if (swipeCurrentX.current < -50) {
                            if (el) el.style.transform = "translateX(-80px)";
                          } else {
                            if (el) el.style.transform = "translateX(0)";
                            swipeCurrentX.current = 0;
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
                            className={`habit-name${
                              isCompleted(habit.id) ? " completed" : ""
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
                          className={`habit-checkbox${
                            isCompleted(habit.id) ? " checked" : ""
                          }`}
                          onClick={() => toggleHabit(habit.id)}
                          style={{ minHeight: 44, minWidth: 44 }}
                        >
                          {isCompleted(habit.id) && <CheckMark />}
                        </button>
                      </div>
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
                        className={`mood-btn${
                          mood === m.value ? " selected" : ""
                        }`}
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

                <div className="save-btn-wrap">
                  <button
                    className="save-btn"
                    onClick={saveAll}
                    disabled={saving}
                    style={{ minHeight: 50 }}
                  >
                    {saving ? t("saving") : t("saveCheckin")}
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <EditHabitSheet
        key={editingHabit?.id ?? "empty"}
        habit={editingHabit}
        onClose={() => setEditingHabit(null)}
      />

      <FocusPicker
        open={focusOpen}
        habits={day?.habits ?? []}
        focusIds={focusIds}
        limit={FOCUS_LIMIT}
        onToggle={toggleFocus}
        onClose={() => setFocusOpen(false)}
      />
    </div>
  );
}
