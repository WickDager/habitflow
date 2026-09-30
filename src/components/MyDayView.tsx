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
import { EditTaskSheet } from "./EditTaskSheet";
import { FocusPicker } from "./FocusPicker";
import { RowActionsSheet } from "./RowActionsSheet";
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

/** How far a row slides to reveal the delete target. */
const REVEAL_PX = 88;

/**
 * How far a finger has to travel, and how much more of that travel has to be
 * sideways than up-and-down, before a gesture counts as a swipe.
 *
 * Without both tests a scroll is the hazard: the list scrolls vertically, but
 * a thumb arcs sideways on the way down, and once that drift passes the reveal
 * threshold the row opens a delete target the user never asked for. A tap is
 * the other half — it has to be impossible for one to be read as a drag.
 */
const SWIPE_MIN_PX = 10;
const SWIPE_INTENT_RATIO = 1.5;

/**
 * POST check-ins in the batches the route accepts.
 *
 * BulkCheckinSchema is `.min(1).max(20)`, so one request carrying every habit
 * is a 400 as soon as someone has 21 — and the user only sees an unexplained
 * "Save failed". Returns what did not make it, plus the first error, so each
 * caller can decide how loud to be about a partial save.
 */
async function postCheckins(checkins: CheckinDraft[]): Promise<{
  saved: number;
  failed: CheckinDraft[];
  error: unknown;
}> {
  let saved = 0;
  let firstError: unknown = null;
  const failed: CheckinDraft[] = [];

  for (let i = 0; i < checkins.length; i += CHECKIN_BATCH) {
    const chunk = checkins.slice(i, i + CHECKIN_BATCH);
    try {
      await apiFetch("/api/checkins", {
        method: "POST",
        body: JSON.stringify({ checkins: chunk }),
      });
      saved += chunk.length;
    } catch (err) {
      failed.push(...chunk);
      firstError = firstError ?? err;
    }
  }

  return { saved, failed, error: firstError };
}

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
  const [editingTask, setEditingTask] = useState<TodoRow | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  /**
   * The row whose ⋯ menu is open. Held as the row itself rather than as an id
   * — the menu's Edit needs the object, and its Delete needs the row to build
   * the undo payload from — the same way editingHabit/editingTask work.
   */
  const [menuHabit, setMenuHabit] = useState<Habit | null>(null);
  const [menuTask, setMenuTask] = useState<TodoRow | null>(null);
  /** The row currently swiped open, and the one asking to be deleted. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const swipeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeCurrentX = useRef(0);
  const swipeActiveId = useRef<string | null>(null);
  /** Set once a gesture has proved itself a swipe — see SWIPE_MIN_PX. */
  const swipeIsDrag = useRef(false);
  /** Mirrors openId so the close helper can stay stable across renders. */
  const openRowId = useRef<string | null>(null);
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

        // This screen reads the same fact from two endpoints — completion from
        // /api/checkins (above) and the Focus chips' streak badge plus the
        // progress bar from /api/day. Patching only the first left them
        // disagreeing about the same habit until something else refetched, so
        // mirror the pending toggles onto the day cache too. Only `completed`
        // moves: a queued toggle cannot know the post-flush streak.
        mutate(
          dayKey,
          (current: DayResponse | undefined) => {
            if (!current) return current;
            return {
              ...current,
              habits: current.habits.map((h) => {
                const p = pending.find((p) => p.habit_id === h.id);
                return p ? { ...h, completed: p.completed } : h;
              }),
            };
          },
          false
        );
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

  const completedCount = safeHabits.filter((h) => isCompleted(h.id)).length;
  const progressPct = safeHabits.length
    ? Math.round((completedCount / safeHabits.length) * 100)
    : 0;

  const focusedHabits = useMemo(
    () => (day?.habits ?? []).filter((habit) => habit.focused),
    [day]
  );

  /* ── Swipe-to-delete bookkeeping ──
     .habit-row transitions transform over 200ms, which makes the row trail the
     finger; the drag turns the transition off for its duration. */
  const setRowOffset = useCallback((id: string, offset: number) => {
    const el = swipeRefs.current.get(id);
    if (el) el.style.transform = `translateX(${offset}px)`;
  }, []);

  /**
   * Reset the row that was left slid open and forget it.
   *
   * The offset lives on the DOM node, not in React, so state alone would leave
   * the visual behind: both have to be cleared. Kept stable on purpose — a
   * callback that changed identity with openId would close the row the moment
   * it opened.
   */
  const closeOpenRow = useCallback(() => {
    const id = openRowId.current;
    if (id) setRowOffset(id, 0);
    openRowId.current = null;
    setOpenId(null);
  }, [setRowOffset]);

  const openRow = useCallback(
    (id: string) => {
      // One row at a time: several open rows leave several live delete targets
      // behind the list.
      if (openRowId.current && openRowId.current !== id) closeOpenRow();
      openRowId.current = id;
      setOpenId(id);
    },
    [closeOpenRow]
  );

  /**
   * The row allowed to look open, which is not quite the same as the row that
   * was opened.
   *
   * The list changes under an open row all the time — a delete from the edit
   * sheet, an optimistic removal, a revalidation — and a row that is no longer
   * in the list cannot be revealed. Derived rather than reset from an effect,
   * because a stale transform can never land on the wrong habit: React keeps
   * each row's DOM node keyed by habit id, so a surviving row carries its own
   * offset and a removed one takes its offset with it.
   */
  const revealedId =
    openId && safeHabits.some((h) => h.id === openId) ? openId : null;

  /** Revalidate every filtered todo list, not just one exact key. */
  const refreshTodoLists = useCallback(
    () =>
      mutate((key) => typeof key === "string" && key.startsWith("/api/todos")),
    [mutate]
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
        const result = await postCheckins(group);
        saved += result.saved;
        unsent.push(...result.failed);
        firstError = firstError ?? result.error;
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

  /**
   * Write one habit's state for today, in either direction.
   *
   * The direction is a parameter rather than a flip of what is on screen: the
   * checkbox wants a flip, but the ⋯ menu offers "Mark done" and "Mark undone"
   * as two separate promises, and a flip would quietly deliver the opposite
   * for either of them if the row's state had moved on since the menu opened.
   */
  const setHabitCompleted = useCallback(
    async (habitId: string, completed: boolean) => {
      haptics.light();

      const optimistic = safeHabits.map((h) =>
        h.id === habitId
          ? {
              ...h,
              checkins: [
                {
                  habit_id: h.id,
                  date: today,
                  completed,
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
              checkins: [{ habit_id: habitId, date: today, completed }],
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
        if (idx >= 0) pending[idx].completed = completed;
        else
          pending.push({
            habit_id: habitId,
            date: today,
            completed,
          });
        await savePendingCheckins(pending);
      }
    },
    [checkinsKey, dayKey, mutate, offline, safeHabits, t, today, toast]
  );

  const toggleHabit = useCallback(
    (habitId: string) => setHabitCompleted(habitId, !isCompleted(habitId)),
    [isCompleted, setHabitCompleted]
  );

  /**
   * Whether today has ever shown a task on this screen.
   *
   * /api/day lists *open* tasks only — a finished one leaves the list the
   * moment it is ticked — so "the day had tasks" cannot be read off the
   * current response. Without this, someone who keeps only tasks would tick
   * their last one and get nothing at all: by then both lists are empty, and
   * the day looks exactly like one that never had anything in it.
   */
  const [sawTasks, setSawTasks] = useState(false);
  useEffect(() => {
    // Latches on, never off for the life of the screen: the question is
    // whether the day *had* work in it, not whether it has any now. Set from
    // an effect because it is a fact about the past that arrives with the
    // data — and it cannot turn `everythingDone` true early, since a non-empty
    // task list fails that test on its own.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    if (tasks.length > 0) setSawTasks(true);
  }, [tasks]);

  /**
   * The end of the day, in one boolean.
   *
   * It used to be habits only, so a day with every habit ticked and tasks
   * still open got the confetti — and the celebration replaces the whole view,
   * which took the outstanding tasks off the screen with it. Now it takes over
   * only when there is genuinely nothing left: every habit done, and nothing
   * open on the task list (that list holds open tasks alone, so an empty one
   * *is* every task done). A day with only one of the two still celebrates
   * once that one is finished; a day that never had either does not celebrate
   * at all.
   */
  const everythingDone =
    (safeHabits.length > 0 || sawTasks) &&
    safeHabits.every((h) => isCompleted(h.id)) &&
    tasks.length === 0;

  /** Latches the celebration to the crossing, not to the state. */
  const celebrated = useRef(false);

  useEffect(() => {
    if (!everythingDone) {
      // Re-arm, and take the overlay down with it: this effect's own cleanup
      // has already cleared the timer that would have hidden it, so a day that
      // stops being done mid-celebration would otherwise leave it up for good.
      celebrated.current = false;
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setShowCelebration(false);
      return;
    }
    // Every revalidation hands back fresh arrays for unchanged facts, which is
    // what used to fire this on every fetch. The dependency is the derived
    // boolean — stable across those fetches — and the latch covers the day
    // that flaps back and forth.
    if (celebrated.current) return;
    celebrated.current = true;

    haptics.success();
    setShowCelebration(true);
    // The burst is the part worth skipping for someone who has asked their
    // system for less movement; the overlay and its timer still say "all done".
    if (
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { x: 0.5, y: 0.5 },
        colors: ["#34c759", "#ff9f0a", "#2678b6", "#ff3b30"],
      });
    }
    const timer = setTimeout(() => setShowCelebration(false), 1800);
    return () => clearTimeout(timer);
  }, [everythingDone]);

  /**
   * The red target and the ⋯ menu's Delete both only ask the question; the
   * confirm block under the row is what deletes.
   */
  const requestDelete = useCallback(
    (habitId: string) => {
      haptics.medium();
      closeOpenRow();
      setConfirmDeleteId(habitId);
    },
    [closeOpenRow]
  );

  /**
   * Deleting from the swipe is a confirmation, not an optimistic delete with
   * an undo.
   *
   * Undo is the softer gesture, but there is nothing that could put the habit
   * back: DELETE /api/habits/:id archives the row (archived_at) and no route
   * clears that column — HabitPatchSchema only carries name, icon and
   * sort_order, so a "restore" could only re-create a brand new habit, without
   * its check-in history and without its focus pin. That is a worse lie than
   * asking first, so the swipe is two steps (slide, then confirm) and the
   * ⋯ menu's Delete is two steps as well (pick Delete, then confirm in the
   * same block under the row). Confirming is also the shape of the delete in
   * EditHabitSheet, so all three agree.
   */
  const deleteHabit = useCallback(
    async (habitId: string) => {
      haptics.medium();
      // The row can leave the list before the request settles, so the confirm
      // block is retired first and the button is held down by deletingId.
      setDeletingId(habitId);
      setConfirmDeleteId(null);
      closeOpenRow();
      const optimistic = safeHabits.filter((h) => h.id !== habitId);
      await mutate(checkinsKey, optimistic, false);
      try {
        await apiFetch(`/api/habits/${habitId}`, { method: "DELETE" });
        await mutate(checkinsKey);
        await mutate(dayKey);
        await mutate("/api/checkins/stats");
        haptics.success();
        toast(t("deleted"), { kind: "success" });
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
        await mutate(checkinsKey);
      } finally {
        setDeletingId(null);
      }
    },
    [checkinsKey, closeOpenRow, dayKey, mutate, safeHabits, t, toast]
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

      // Chunked rather than one request: the route rejects more than 20 rows
      // in a single body, so a user with 21 habits got a bare "Save failed"
      // and nothing was written.
      const { failed, error: firstError } = await postCheckins(checkins);

      if (failed.length > 0) {
        haptics.error();
        // Whatever did land is real, so the day is refetched instead of being
        // left showing the pre-save state.
        await mutate(dayKey);
        toast(errorMessage(firstError, t), { kind: "error" });
        return;
      }

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
      // The tasks tab, the Today list and every filter all read /api/todos —
      // under different query strings. A string key only matches itself, so
      // the deleted "/api/todos" invalidated nothing.
      await refreshTodoLists();
    },
    [dayKey, mutate, refreshTodoLists]
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

  /**
   * The other direction, for someone who ticked a task by mistake.
   *
   * completeTask() is a one-way door — it drops the row from the day and
   * offers only its own undo — so the ⋯ menu's "Mark undone" needs its own
   * path back: PATCH the flag off and let the day refetch bring the row back
   * where it belongs.
   */
  const uncompleteTask = useCallback(
    async (task: TodoRow) => {
      haptics.medium();
      try {
        await setTaskCompleted(task, false);
        haptics.success();
        toast(t("saved"), { kind: "success" });
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
        await mutate(dayKey);
      }
    },
    [dayKey, mutate, setTaskCompleted, t, toast]
  );

  /** Put a just-deleted task back, the way the toast's Undo promises. */
  const restoreTask = useCallback(
    async (task: TodoRow) => {
      try {
        await apiFetch("/api/todos", {
          method: "POST",
          body: JSON.stringify({
            title: task.title,
            due_date: task.due_date,
            due_time: task.due_time,
            priority: task.priority,
            notes: task.notes,
            subtasks: task.subtasks ?? [],
            recurrence: task.recurrence,
            // No tags: /api/day returns bare todo rows and does not attach the
            // todo_tags side table, so there is nothing here to restore them
            // from. An untagged task back is a better trade than a round trip
            // per row on the screen the app opens on.
          }),
        });
        await mutate(dayKey);
        await refreshTodoLists();
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
      }
    },
    [dayKey, mutate, refreshTodoLists, t, toast]
  );

  /**
   * Delete a task optimistically, and offer to undo it.
   *
   * Where a habit can only be archived (see deleteHabit), a task can genuinely
   * be put back: DELETE /api/todos/:id drops the row and POST /api/todos
   * writes an equivalent one, so the honest gesture here is the reversible
   * one. The restored task carries a new id and lands at the end of its list,
   * which is the same trade TasksView already makes.
   */
  const deleteTask = useCallback(
    async (task: TodoRow) => {
      haptics.medium();

      // Gone from both lists at once: it is deleted, so leaving it on screen
      // until the request lands makes the menu feel stuck.
      await mutate(
        dayKey,
        (current?: DayResponse) =>
          current
            ? {
                ...current,
                tasks: current.tasks.filter((item) => item.id !== task.id),
                overdue: current.overdue.filter((item) => item.id !== task.id),
                rollsOverdueCount: current.overdue.filter(
                  (item) => item.id !== task.id
                ).length,
              }
            : current,
        false
      );

      try {
        await apiFetch(`/api/todos/${task.id}`, { method: "DELETE" });
        haptics.success();
        toast(t("deleted"), {
          kind: "success",
          action: { label: t("undo"), onClick: () => void restoreTask(task) },
        });
        await mutate(dayKey);
        await refreshTodoLists();
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
        await mutate(dayKey);
      }
    },
    [dayKey, mutate, refreshTodoLists, restoreTask, t, toast]
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
        await refreshTodoLists();
        haptics.success();
        toast(t("rolledOver"), { kind: "success" });
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
      }
    },
    [dayKey, mutate, refreshTodoLists, t, today, toast]
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
   * Tapping the row opens the task sheet; the checkbox is the only thing that
   * completes. The row used to be a second, silent "complete" button — which
   * made the list feel like it was deleting things — and there was no route at
   * all from this screen into editing or rescheduling a task.
   */
  const openTask = useCallback(
    (task: TodoRow) => {
      closeOpenRow();
      setEditingTask(task);
    },
    [closeOpenRow]
  );

  /**
   * The sheet refreshes the /api/todos family itself, but this screen reads
   * /api/day: without this the edited title stays stale here, a task moved off
   * today keeps its row, and one moved onto today never appears.
   */
  const closeTaskSheet = useCallback(() => {
    setEditingTask(null);
    void mutate(dayKey);
  }, [dayKey, mutate]);

  /* ── The ⋯ row menu ──
     Habits and tasks share one menu, so the two are held in separate slots and
     only one is ever set. Each handler takes the row out of state before it
     runs: the sheet has done its job the moment a verb is chosen, and a menu
     left open over a row that has already changed would be lying about it. */
  const closeRowMenu = useCallback(() => {
    setMenuHabit(null);
    setMenuTask(null);
  }, []);

  /**
   * Opening the menu puts the swipe reveal away first.
   *
   * A slid-open row is a live delete target underneath the sheet — two delete
   * affordances for one row, one of them hidden. The reveal is also what the
   * owner could not reach with a mouse in the first place.
   */
  const openHabitMenu = useCallback(
    (habit: Habit) => {
      haptics.select();
      closeOpenRow();
      setMenuHabit(habit);
    },
    [closeOpenRow]
  );

  const openTaskMenu = useCallback(
    (task: TodoRow) => {
      haptics.select();
      closeOpenRow();
      setMenuTask(task);
    },
    [closeOpenRow]
  );

  const menuMarkDone = useCallback(() => {
    const habit = menuHabit;
    const task = menuTask;
    closeRowMenu();
    if (habit) void setHabitCompleted(habit.id, true);
    else if (task) void completeTask(task);
  }, [closeRowMenu, completeTask, menuHabit, menuTask, setHabitCompleted]);

  const menuMarkUndone = useCallback(() => {
    const habit = menuHabit;
    const task = menuTask;
    closeRowMenu();
    if (habit) void setHabitCompleted(habit.id, false);
    else if (task) void uncompleteTask(task);
  }, [closeRowMenu, menuHabit, menuTask, setHabitCompleted, uncompleteTask]);

  const menuEdit = useCallback(() => {
    const habit = menuHabit;
    const task = menuTask;
    closeRowMenu();
    if (habit) setEditingHabit(habit);
    else if (task) setEditingTask(task);
  }, [closeRowMenu, menuHabit, menuTask]);

  const menuDelete = useCallback(() => {
    const habit = menuHabit;
    const task = menuTask;
    closeRowMenu();
    // A habit delete cannot be reversed (see deleteHabit), so the menu hands
    // off to the same confirm block the swipe opens instead of doing it here.
    // A task delete can be, so it goes straight through with an undo.
    if (habit) requestDelete(habit.id);
    else if (task) void deleteTask(task);
  }, [closeRowMenu, deleteTask, menuHabit, menuTask, requestDelete]);

  /** The open row in the shape RowActionsSheet takes, or null for closed. */
  const rowMenuTarget = menuHabit
    ? {
        id: menuHabit.id,
        title: menuHabit.name,
        completed: isCompleted(menuHabit.id),
        kind: "habit" as const,
      }
    : menuTask
      ? {
          id: menuTask.id,
          title: menuTask.title,
          completed: menuTask.is_completed,
          kind: "task" as const,
        }
      : null;

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
          aria-label={`${t("editTask")}: ${task.title}`}
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

        <button
          type="button"
          className={styles.rowMenuBtn}
          onClick={(e) => {
            // The row's own tap target sits right beside this one; a click
            // that reached it would open the editor behind the menu.
            e.stopPropagation();
            openTaskMenu(task);
          }}
          aria-label={`${t("rowActions")}: ${task.title}`}
        >
          ⋯
        </button>
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
                    <li key={habit.id}>
                      {/* The visible delete target sits under the row inside
                          this module's own wrapper: the global
                          .swipe-delete-bg is locked at opacity:0, so the old
                          swipe revealed blank space and tapping it archived
                          the habit with no warning at all. */}
                      <div className={styles.swipeItem}>
                        <div className={styles.swipeDeleteBg}>
                          <button
                            type="button"
                            className={styles.swipeDeleteBtn}
                            tabIndex={revealedId === habit.id ? 0 : -1}
                            aria-hidden={revealedId !== habit.id}
                            onClick={() => requestDelete(habit.id)}
                            style={{ minHeight: 44 }}
                          >
                            🗑 {t("delete")}
                          </button>
                        </div>
                        <div
                          className={`habit-row ${styles.swipeRow}`}
                          ref={(el) => {
                            // A row that leaves the list has to leave the map:
                            // its offset lives on its own node, and a detached
                            // node is one nothing can ever reset.
                            if (el) swipeRefs.current.set(habit.id, el);
                            else swipeRefs.current.delete(habit.id);
                          }}
                          onTouchStart={(e) => {
                            if (openRowId.current && openRowId.current !== habit.id)
                              closeOpenRow();
                            const touch = e.touches[0];
                            swipeStartX.current = touch.clientX;
                            swipeStartY.current = touch.clientY;
                            swipeCurrentX.current = 0;
                            swipeIsDrag.current = false;
                            swipeActiveId.current = habit.id;
                            // .habit-row transitions transform over 200ms, which
                            // makes the row lag behind the finger; dragging
                            // turns it off.
                            swipeRefs.current
                              .get(habit.id)
                              ?.classList.add(styles.swipeDragging);
                          }}
                          onTouchMove={(e) => {
                            if (swipeActiveId.current !== habit.id) return;
                            const touch = e.touches[0];
                            const dx = touch.clientX - swipeStartX.current;
                            const dy = touch.clientY - swipeStartY.current;

                            if (!swipeIsDrag.current) {
                              // Nothing moves until the gesture has proved it
                              // is a swipe: not a tap, and not the sideways
                              // drift of a thumb scrolling the list.
                              if (Math.abs(dx) < SWIPE_MIN_PX) return;
                              if (
                                Math.abs(dx) <
                                Math.abs(dy) * SWIPE_INTENT_RATIO
                              )
                                return;
                              swipeIsDrag.current = true;
                            }

                            const base = revealedId === habit.id ? -REVEAL_PX : 0;
                            let diff = dx + base;
                            if (diff > 0) diff = 0;
                            if (diff < -REVEAL_PX) diff = -REVEAL_PX;
                            swipeCurrentX.current = diff;
                            setRowOffset(habit.id, diff);
                          }}
                          onTouchEnd={() => {
                            if (swipeActiveId.current !== habit.id) return;
                            swipeActiveId.current = null;
                            // The transition comes back before the offset
                            // moves, so the snap-back animates.
                            swipeRefs.current
                              .get(habit.id)
                              ?.classList.remove(styles.swipeDragging);
                            // A gesture that never dragged — a tap, or a scroll
                            // the browser owns — leaves the list as it found it.
                            const shouldOpen =
                              swipeIsDrag.current &&
                              swipeCurrentX.current <= -REVEAL_PX / 2;
                            swipeIsDrag.current = false;
                            setRowOffset(habit.id, shouldOpen ? -REVEAL_PX : 0);
                            if (shouldOpen) openRow(habit.id);
                            else closeOpenRow();
                          }}
                          onTouchCancel={() => {
                            // The browser took the gesture back for a scroll, and
                            // no touchend is coming: this is the only place the
                            // drag state can be cleared. Without it swipeDragging
                            // sticks to the row and it keeps an
                            // instant-snap transform for the rest of the session.
                            if (swipeActiveId.current !== habit.id) return;
                            swipeActiveId.current = null;
                            swipeIsDrag.current = false;
                            swipeRefs.current
                              .get(habit.id)
                              ?.classList.remove(styles.swipeDragging);
                            setRowOffset(
                              habit.id,
                              openRowId.current === habit.id ? -REVEAL_PX : 0
                            );
                          }}
                        >
                          <button
                            className="habit-info-btn"
                            onClick={() => {
                              closeOpenRow();
                              setEditingHabit(habit);
                            }}
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

                          <button
                            type="button"
                            className={styles.rowMenuBtn}
                            onClick={(e) => {
                              // The row's own tap target sits right beside this
                              // one; a click that reached it would open the
                              // editor behind the menu.
                              e.stopPropagation();
                              openHabitMenu(habit);
                            }}
                            aria-label={`${t("rowActions")}: ${habit.name}`}
                          >
                            ⋯
                          </button>
                        </div>
                      </div>

                      {/* Outside the swipe wrapper on purpose: the wrapper is
                          overflow:hidden and the delete target is absolutely
                          positioned over all of it, so a confirm block inside
                          would be painted under the red. */}
                      {confirmDeleteId === habit.id ? (
                        <div className="delete-confirm">
                          <p className="delete-confirm-text">
                            {t("deleteHabitConfirm")}
                          </p>
                          <div className="sheet-actions">
                            <button
                              className="sheet-cancel-btn"
                              onClick={() => setConfirmDeleteId(null)}
                              style={{ minHeight: 44 }}
                            >
                              {t("cancel")}
                            </button>
                            <button
                              className="sheet-delete-confirm-btn"
                              onClick={() => void deleteHabit(habit.id)}
                              disabled={deletingId === habit.id}
                              style={{ minHeight: 44 }}
                            >
                              {deletingId === habit.id ? t("saving") : t("delete")}
                            </button>
                          </div>
                        </div>
                      ) : null}
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

      {/* Keyed by id so the sheet remounts with the tapped task's own fields
          instead of keeping the previous one's state. */}
      <EditTaskSheet
        key={editingTask?.id ?? "empty"}
        task={editingTask}
        onClose={closeTaskSheet}
      />

      <FocusPicker
        open={focusOpen}
        habits={day?.habits ?? []}
        focusIds={focusIds}
        limit={FOCUS_LIMIT}
        onToggle={toggleFocus}
        onClose={() => setFocusOpen(false)}
      />

      {/* Keyed by the row's id, like the sheets above: the menu has to mount
          onto the row that was tapped rather than keep the previous one's. */}
      <RowActionsSheet
        key={menuHabit?.id ?? menuTask?.id ?? "empty"}
        target={rowMenuTarget}
        onMarkDone={menuMarkDone}
        onMarkUndone={menuMarkUndone}
        onEdit={menuEdit}
        onDelete={menuDelete}
        onClose={closeRowMenu}
      />
    </div>
  );
}
