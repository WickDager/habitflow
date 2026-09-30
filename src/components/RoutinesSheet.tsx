"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { useToast } from "@/components/Toast";
import { useLanguage, type Lang } from "@/lib/i18n";
import styles from "./RoutinesSheet.module.css";

/**
 * Routines — "these habits, together, on these days".
 *
 * Self-contained: it fetches its own data and writes through the API, so the
 * app only has to mount <RoutinesSheet open={...} onClose={...} />.
 */

interface RoutineItem {
  habit_id: string;
  sort_order: number;
  name: string | null;
  icon: string | null;
  archived: boolean;
}

interface Routine {
  id: string;
  name: string;
  icon: string | null;
  /** 0=Sunday..6=Saturday; empty means every day. */
  days: number[];
  sort_order: number;
  items: RoutineItem[];
}

interface Habit {
  id: string;
  name: string;
  icon: string;
}

interface RoutinesSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Same palette CreateModal offers for habits. */
const EMOJIS = ["🏃", "📚", "💧", "🧘", "💤", "🍎", "✍️", "🎯", "💻", "🧹"];

/**
 * Narrow weekday names from Intl rather than a hardcoded table, so the picker
 * is translated with the rest of the UI. 2024-01-07 was a Sunday, which is
 * index 0 of the days[] convention.
 */
function weekdayLabels(lang: Lang): string[] {
  const format = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
    weekday: "narrow",
  });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(2024, 0, 7 + index))
  );
}

export function RoutinesSheet({ open, onClose }: RoutinesSheetProps) {
  const { t, lang } = useLanguage();
  const { mutate } = useSWRConfig();
  const { toast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(EMOJIS[0]);
  const [days, setDays] = useState<number[]>([]);
  const [habitIds, setHabitIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const {
    data: routines,
    isLoading,
    mutate: mutateRoutines,
  } = useSWR<Routine[]>(open ? "/api/routines" : null, apiFetch);
  const { data: habits } = useSWR<Habit[]>(open ? "/api/habits" : null, apiFetch);

  const labels = useMemo(() => weekdayLabels(lang), [lang]);

  useEffect(() => {
    if (open) haptics.select();
  }, [open]);

  /**
   * Reset while rendering rather than in an effect — React's recommended way to
   * clear state when a prop flips, and it saves a second render on every open.
   * Each open starts on a clean list: no half-filled form, no stale error.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFormOpen(false);
      setEditingId(null);
      setConfirmId(null);
      setError("");
    }
  }

  /**
   * Applying a routine writes today's check-ins, so every view that reads them
   * has to refresh. Matched by prefix instead of by exact key: each of those
   * views builds its key from its own idea of "today" and we would miss it.
   */
  const revalidateDay = () =>
    mutate(
      (key) => {
        const path =
          typeof key === "string" ? key : Array.isArray(key) ? key[0] : null;
        return (
          typeof path === "string" &&
          (path.startsWith("/api/checkins") ||
            path.startsWith("/api/streak") ||
            // The day view's key is /api/day?date=…, and the Focus chips read
            // their streak badge from it. Neither of the prefixes above matches
            // it, so the badge stayed stale after Apply.
            path.startsWith("/api/day"))
        );
      },
      undefined,
      { revalidate: true }
    );

  const resetForm = () => {
    setEditingId(null);
    setFormOpen(false);
    setName("");
    setIcon(EMOJIS[0]);
    setDays([]);
    setHabitIds([]);
    setError("");
  };

  const startCreate = () => {
    haptics.select();
    resetForm();
    setFormOpen(true);
  };

  const startEdit = (routine: Routine) => {
    haptics.select();
    setEditingId(routine.id);
    setName(routine.name);
    setIcon(routine.icon ?? EMOJIS[0]);
    setDays(routine.days);
    setHabitIds(routine.items.map((item) => item.habit_id));
    setError("");
    setFormOpen(true);
  };

  const toggleDay = (day: number) => {
    haptics.select();
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const toggleHabit = (habitId: string) => {
    haptics.select();
    setHabitIds((prev) =>
      prev.includes(habitId)
        ? prev.filter((id) => id !== habitId)
        : [...prev, habitId]
    );
  };

  const apply = async (routine: Routine) => {
    setBusyId(routine.id);
    try {
      const result = await apiFetch<{ applied: number; scheduled: boolean }>(
        `/api/routines/${routine.id}/apply`,
        // No date: the server uses the user's own calendar day.
        { method: "POST", body: JSON.stringify({}) }
      );
      haptics.success();
      await revalidateDay();
      if (!result.scheduled) {
        // A routine with fixed days answers scheduled: false on a weekday it is
        // not planned for. Nothing was written, so "Saved" would claim a change
        // that never happened.
        toast(t("routineNotScheduled"), { kind: "info" });
      } else {
        toast(
          result.applied > 0
            ? t("routineApplied", { count: result.applied })
            : t("saved"),
          { kind: "success" }
        );
      }
    } catch (err) {
      haptics.error();
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    setError("");
    try {
      const payload = {
        name: trimmed,
        icon,
        days,
        habit_ids: habitIds,
      };

      if (editingId) {
        await apiFetch(`/api/routines/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/routines", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      haptics.success();
      await mutateRoutines();
      resetForm();
      toast(t("saved"), { kind: "success" });
    } catch (err) {
      haptics.error();
      setError(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (routineId: string) => {
    setBusyId(routineId);
    try {
      await apiFetch(`/api/routines/${routineId}`, { method: "DELETE" });
      haptics.success();
      await mutateRoutines();
      setConfirmId(null);
      toast(t("deleted"), { kind: "success" });
    } catch (err) {
      haptics.error();
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  const list = routines ?? [];
  const habitOptions = habits ?? [];

  return (
    <>
      {/* Chrome from globals.css, not a local copy: the two sheets used to
          carry their own overlay/sheet rules and drifted from the shared ones. */}
      <div className="sheet-overlay" onClick={onClose} aria-hidden="true" />
      <div className="bottom-sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />

        {formOpen ? (
          <div className={styles.form}>
            <h3 className={styles.formTitle}>
              {editingId ? t("routines") : t("newRoutine")}
            </h3>

            <label className={styles.field}>
              <span>{t("routineName")}</span>
              <input
                className={styles.input}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={50}
                onKeyDown={(event) => event.key === "Enter" && save()}
              />
            </label>

            <div className={styles.emojiPicker}>
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`${styles.emojiOption} ${
                    icon === emoji ? styles.selected : ""
                  }`}
                  onClick={() => {
                    haptics.select();
                    setIcon(emoji);
                  }}
                  aria-label={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className={styles.field}>
              <span>{t("routineDays")}</span>
              <div className={styles.weekdays}>
                {labels.map((label, day) => (
                  <button
                    key={day}
                    type="button"
                    className={`${styles.weekday} ${
                      days.includes(day) ? styles.selected : ""
                    }`}
                    onClick={() => toggleDay(day)}
                    aria-pressed={days.includes(day)}
                    aria-label={label}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Nothing selected is the "every day" case, same as days = []. */}
              {days.length === 0 && (
                <span className={styles.hint}>{t("everyDay")}</span>
              )}
            </div>

            <div className={styles.field}>
              <span>{t("routineHabits")}</span>
              {habitOptions.length === 0 ? (
                <p className={styles.hint}>{t("noHabitsYet")}</p>
              ) : (
                <div className={styles.habitList}>
                  {habitOptions.map((habit) => {
                    const selected = habitIds.includes(habit.id);
                    return (
                      <button
                        key={habit.id}
                        type="button"
                        className={`${styles.habitRow} ${
                          selected ? styles.selected : ""
                        }`}
                        onClick={() => toggleHabit(habit.id)}
                        aria-pressed={selected}
                      >
                        <span className={styles.cardIcon}>{habit.icon}</span>
                        <span className={styles.habitRowName}>{habit.name}</span>
                        <span className={styles.check}>
                          {selected ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={resetForm}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className={styles.submitBtn}
                onClick={save}
                disabled={saving || !name.trim()}
              >
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <div>
                <h3 className={styles.title}>{t("routines")}</h3>
                <p className={styles.hint}>{t("routineHabits")}</p>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={onClose}
                aria-label={t("cancel")}
              >
                ✕
              </button>
            </div>

            {isLoading && list.length === 0 ? null : list.length === 0 ? (
              <p className={styles.empty}>{t("noRoutinesYet")}</p>
            ) : (
              list.map((routine) => (
                <div key={routine.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span className={styles.cardIcon}>
                      {routine.icon ?? routine.items[0]?.icon ?? "🔁"}
                    </span>
                    <span className={styles.cardName}>{routine.name}</span>
                  </div>

                  <div className={styles.chips}>
                    {routine.days.length === 0 ? (
                      <span className={styles.chip}>{t("everyDay")}</span>
                    ) : (
                      routine.days.map((day) => (
                        <span key={day} className={styles.chip}>
                          {labels[day]}
                        </span>
                      ))
                    )}
                  </div>

                  {routine.items.length > 0 && (
                    <p className={styles.cardItems}>
                      {routine.items.map((item) => (
                        <span
                          key={item.habit_id}
                          className={item.archived ? styles.archived : undefined}
                        >
                          {item.icon ?? "•"} {item.name}{" "}
                        </span>
                      ))}
                    </p>
                  )}

                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.applyBtn}
                      onClick={() => apply(routine)}
                      disabled={busyId === routine.id}
                    >
                      {busyId === routine.id ? t("saving") : t("applyRoutine")}
                    </button>
                    {/* Glyph only: the i18n tables have no generic "edit"
                        string (only editHabit/editTask), and borrowing one of
                        those would label a routine with the wrong word. The
                        accessible name is the routine's own name. */}
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => startEdit(routine)}
                      aria-label={routine.name}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className={`${styles.ghostBtn} ${styles.dangerBtn}`}
                      onClick={() => {
                        haptics.medium();
                        setConfirmId(routine.id);
                      }}
                      aria-label={t("deleteRoutine")}
                    >
                      🗑
                    </button>
                  </div>

                  {confirmId === routine.id && (
                    <div className={styles.deleteConfirm}>
                      <p className={styles.deleteConfirmText}>
                        {t("deleteRoutine")}
                      </p>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.cancelBtn}
                          onClick={() => setConfirmId(null)}
                        >
                          {t("cancel")}
                        </button>
                        <button
                          type="button"
                          className={styles.deleteConfirmBtn}
                          onClick={() => remove(routine.id)}
                          disabled={busyId === routine.id}
                        >
                          {busyId === routine.id ? t("saving") : t("delete")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}

            <button
              type="button"
              className={styles.applyBtn}
              onClick={startCreate}
              style={{ marginTop: "var(--space-sm)" }}
            >
              {t("newRoutine")}
            </button>
          </>
        )}
      </div>
    </>
  );
}
