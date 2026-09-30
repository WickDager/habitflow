"use client";

import { useCallback, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";
import { describeDueDate } from "@/lib/nlpDate";
import { todayLocal } from "@/lib/dates";
import { useToast } from "@/components/Toast";
import type { Recurrence, Subtask } from "@/lib/database.types";
import { HabitSkeleton } from "./HabitSkeleton";
import { EditTaskSheet } from "./EditTaskSheet";
import { QuickAddBar } from "./QuickAddBar";
import { RowActionsSheet } from "./RowActionsSheet";
import styles from "./TasksView.module.css";

export interface Todo {
  id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  is_completed: boolean;
  priority: number;
  notes: string | null;
  subtasks: Subtask[] | null;
  recurrence: Recurrence | null;
  created_at: string;
  /** Attached by GET /api/todos from the todo_tags side table. */
  tags?: string[];
}

type Filter = "all" | "today" | "overdue" | "high";

const FILTERS: { id: Filter; labelKey: string }[] = [
  { id: "all", labelKey: "filterAll" },
  { id: "today", labelKey: "filterToday" },
  { id: "overdue", labelKey: "filterOverdue" },
  { id: "high", labelKey: "filterHighPriority" },
];

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

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path className="check-path" d="M3 8.5L6.5 12L13 4" />
    </svg>
  );
}

export function TasksView() {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const { t, lang } = useLanguage();
  // Due dates need both the translation and a matching date locale, or a
  // Russian user sees "Tomorrow" and English month names.
  const dateI18n = { t, locale: lang === "ru" ? "ru-RU" : "en-GB" };
  const [editingTask, setEditingTask] = useState<Todo | null>(null);
  /** The row whose ⋯ menu is open. Held as the row: Edit and the undo payload
      both need the whole object, the same way editingTask does. */
  const [menuTask, setMenuTask] = useState<Todo | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // The device's local day, not the server's: the API is told which day
  // "today" means for this user.
  const today = todayLocal();
  const listKey = `/api/todos?filter=${filter}${
    filter === "today" ? `&date=${today}` : ""
  }`;

  const { data: todos, isLoading, error } = useSWR<Todo[]>(
    listKey,
    apiFetch,
    {
      fallbackData: [],
      onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
        if (err.message?.includes("init data is missing")) return;
        if (retryCount >= 3) return;
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
    }
  );

  /** Revalidate every filtered list, not just the one on screen. */
  const refresh = useCallback(
    () =>
      mutate((key) => typeof key === "string" && key.startsWith("/api/todos")),
    [mutate]
  );

  /* ── Swipe-to-reveal bookkeeping ──
     The same shape My Day uses. The offset lives on the DOM node, not in
     React, so state alone would leave the visual behind: both have to be
     cleared together, and the ref that mirrors them is what keeps the close
     helper stable across renders. */
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeCurrentX = useRef(0);
  const swipeActiveId = useRef<string | null>(null);
  /** Set once a gesture has proved itself a swipe — see SWIPE_MIN_PX. */
  const swipeIsDrag = useRef(false);
  /** Mirrors openId so the close helper can stay stable across renders. */
  const openRowId = useRef<string | null>(null);

  const setRowOffset = useCallback((id: string, offset: number) => {
    const el = rowRefs.current.get(id);
    if (el) el.style.transform = `translateX(${offset}px)`;
  }, []);

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

  const list = todos ?? [];

  /**
   * The row allowed to look open, which is not quite the same as the row that
   * was opened: the list changes under an open row all the time — a delete, an
   * optimistic removal, a refetch — and a row that is no longer in the list
   * cannot be revealed.
   */
  const revealedId =
    openId && list.some((item) => item.id === openId) ? openId : null;

  const setCompleted = useCallback(
    async (todo: Todo, completed: boolean) => {
      haptics.medium();

      const optimistic = (todos ?? []).map((item) =>
        item.id === todo.id ? { ...item, is_completed: completed } : item
      );
      await mutate(listKey, optimistic, false);

      try {
        await apiFetch(`/api/todos/${todo.id}`, {
          method: "PATCH",
          // The direction is explicit rather than a flip of what is on screen:
          // the checkbox wants a flip, but the ⋯ menu promises "Mark done" and
          // "Mark undone" by name, and a flip would deliver the opposite of one
          // of them if the row had moved on since the menu opened. The route
          // stamps completed_at itself for either direction.
          body: JSON.stringify({ is_completed: completed }),
        });
        // Completing a recurring task also creates its next occurrence, so
        // this has to refetch rather than merge what is on screen.
        await refresh();
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
        await refresh();
      }
    },
    [listKey, mutate, refresh, t, toast, todos]
  );

  const toggleTodo = useCallback(
    (todo: Todo) => setCompleted(todo, !todo.is_completed),
    [setCompleted]
  );

  const restoreTodo = useCallback(
    async (todo: Todo) => {
      try {
        await apiFetch("/api/todos", {
          method: "POST",
          body: JSON.stringify({
            title: todo.title,
            due_date: todo.due_date,
            due_time: todo.due_time,
            priority: todo.priority,
            notes: todo.notes,
            subtasks: todo.subtasks ?? [],
            recurrence: todo.recurrence,
            tags: todo.tags ?? [],
          }),
        });
        await refresh();
      } catch (err) {
        toast(errorMessage(err, t), { kind: "error" });
      }
    },
    [refresh, t, toast]
  );

  const deleteTodo = useCallback(
    async (todo: Todo) => {
      haptics.medium();
      // The row goes back to its resting place before it goes away: the offset
      // is on the node, so a row that comes back on a failed delete would
      // otherwise come back already slid open.
      closeOpenRow();

      const optimistic = (todos ?? []).filter((item) => item.id !== todo.id);
      await mutate(listKey, optimistic, false);

      try {
        await apiFetch(`/api/todos/${todo.id}`, { method: "DELETE" });
        // Undo re-creates the task from the row we just dropped; it comes
        // back with a new id and at the end of the list.
        toast(t("deleted"), {
          kind: "success",
          action: { label: t("undo"), onClick: () => void restoreTodo(todo) },
        });
        await refresh();
      } catch (err) {
        haptics.error();
        toast(errorMessage(err, t), { kind: "error" });
        await refresh();
      }
    },
    [closeOpenRow, listKey, mutate, refresh, restoreTodo, t, toast, todos]
  );

  /* ── The ⋯ row menu ──
     The same four verbs My Day offers, on the same rows: the swipe above is a
     shortcut for a finger, and this is the path that works for a mouse. */
  const openTaskMenu = useCallback(
    (todo: Todo) => {
      haptics.select();
      // The reveal is a second delete target for the same row, and it would
      // sit under the sheet; put the row back before it opens.
      closeOpenRow();
      setMenuTask(todo);
    },
    [closeOpenRow]
  );

  const closeRowMenu = useCallback(() => setMenuTask(null), []);

  const menuMarkDone = useCallback(() => {
    const todo = menuTask;
    closeRowMenu();
    if (todo) void setCompleted(todo, true);
  }, [closeRowMenu, menuTask, setCompleted]);

  const menuMarkUndone = useCallback(() => {
    const todo = menuTask;
    closeRowMenu();
    if (todo) void setCompleted(todo, false);
  }, [closeRowMenu, menuTask, setCompleted]);

  const menuEdit = useCallback(() => {
    const todo = menuTask;
    closeRowMenu();
    if (todo) setEditingTask(todo);
  }, [closeRowMenu, menuTask, setEditingTask]);

  const menuDelete = useCallback(() => {
    const todo = menuTask;
    closeRowMenu();
    if (todo) void deleteTodo(todo);
  }, [closeRowMenu, deleteTodo, menuTask]);

  const subtaskProgressOf = (todo: Todo) => {
    const subtasks = todo.subtasks ?? [];
    return subtasks.length
      ? t("subtaskProgress", {
          done: subtasks.filter((subtask) => subtask.done).length,
          total: subtasks.length,
        })
      : null;
  };

  return (
    <div className="today-view">
      <QuickAddBar />

      <div className={styles.filters} role="group" aria-label={t("filterAll")}>
        {FILTERS.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            className={`${styles.filterChip} ${
              filter === id ? styles.filterChipActive : ""
            }`}
            aria-pressed={filter === id}
            onClick={() => {
              // The list is about to change identity, and a row that survives
              // the switch (a task in both "all" and "today") would keep the
              // transform its node is carrying. Put it back before the new
              // rows render into it. Reset here rather than from an effect on
              // listKey: a derived reset cannot land on a row that has already
              // gone, and an effect would close a reveal on every refetch.
              closeOpenRow();
              setFilter(id);
            }}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <HabitSkeleton count={3} />
      ) : error ? (
        <div className="error-state" role="alert">
          {t("loadingError")}
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-emoji">📭</span>
          <span className="empty-state-text">{t("noTasksYet")}</span>
        </div>
      ) : (
        <ul className="habit-list">
          {list.map((todo) => {
            const subtaskLabel = subtaskProgressOf(todo);
            const isOverdue =
              !todo.is_completed && !!todo.due_date && todo.due_date < today;
            const open = revealedId === todo.id;

            return (
              <li key={todo.id} className={styles.swipeItem}>
                {/* Red target sits under the row, in this module's CSS: the
                    global .swipe-delete-bg is permanently opacity:0, which is
                    why the old swipe revealed blank space. */}
                <div className={styles.swipeDeleteBg}>
                  <button
                    type="button"
                    className={styles.swipeDeleteBtn}
                    tabIndex={open ? 0 : -1}
                    aria-hidden={!open}
                    onClick={() => void deleteTodo(todo)}
                  >
                    🗑 {t("delete")}
                  </button>
                </div>

                <div
                  className={`habit-row ${styles.swipeRow}`}
                  ref={(el) => {
                    // A row that leaves the list has to leave the map: its
                    // offset lives on its own node, and a detached node is one
                    // nothing can ever reset.
                    if (el) rowRefs.current.set(todo.id, el);
                    else rowRefs.current.delete(todo.id);
                  }}
                  style={todo.is_completed ? { opacity: 0.55 } : undefined}
                  onTouchStart={(e) => {
                    if (openRowId.current && openRowId.current !== todo.id)
                      closeOpenRow();
                    const touch = e.touches[0];
                    swipeStartX.current = touch.clientX;
                    swipeStartY.current = touch.clientY;
                    swipeCurrentX.current = 0;
                    swipeIsDrag.current = false;
                    swipeActiveId.current = todo.id;
                    // .habit-row transitions transform over 200ms, which makes
                    // the row lag behind the finger; dragging turns it off.
                    rowRefs.current
                      .get(todo.id)
                      ?.classList.add(styles.swipeDragging);
                  }}
                  onTouchMove={(e) => {
                    if (swipeActiveId.current !== todo.id) return;
                    const touch = e.touches[0];
                    const dx = touch.clientX - swipeStartX.current;
                    const dy = touch.clientY - swipeStartY.current;

                    if (!swipeIsDrag.current) {
                      // Nothing moves until the gesture has proved it is a
                      // swipe: not a tap, and not the sideways drift of a thumb
                      // scrolling the list.
                      if (Math.abs(dx) < SWIPE_MIN_PX) return;
                      if (Math.abs(dx) < Math.abs(dy) * SWIPE_INTENT_RATIO)
                        return;
                      swipeIsDrag.current = true;
                    }

                    const base = revealedId === todo.id ? -REVEAL_PX : 0;
                    let diff = dx + base;
                    if (diff > 0) diff = 0;
                    if (diff < -REVEAL_PX) diff = -REVEAL_PX;
                    swipeCurrentX.current = diff;
                    setRowOffset(todo.id, diff);
                  }}
                  onTouchEnd={() => {
                    if (swipeActiveId.current !== todo.id) return;
                    swipeActiveId.current = null;
                    // The transition comes back before the offset moves, so the
                    // snap-back animates.
                    rowRefs.current
                      .get(todo.id)
                      ?.classList.remove(styles.swipeDragging);
                    // A gesture that never dragged — a tap, or a scroll the
                    // browser owns — leaves the list as it found it.
                    const shouldOpen =
                      swipeIsDrag.current &&
                      swipeCurrentX.current <= -REVEAL_PX / 2;
                    swipeIsDrag.current = false;
                    setRowOffset(todo.id, shouldOpen ? -REVEAL_PX : 0);
                    if (shouldOpen) openRow(todo.id);
                    else closeOpenRow();
                  }}
                  onTouchCancel={() => {
                    // The browser took the gesture back for a scroll, and no
                    // touchend is coming: this is the only place the drag state
                    // can be cleared. Without it swipeDragging sticks to the row
                    // and it keeps an instant-snap transform for the session.
                    if (swipeActiveId.current !== todo.id) return;
                    swipeActiveId.current = null;
                    swipeIsDrag.current = false;
                    rowRefs.current
                      .get(todo.id)
                      ?.classList.remove(styles.swipeDragging);
                    setRowOffset(
                      todo.id,
                      openRowId.current === todo.id ? -REVEAL_PX : 0
                    );
                  }}
                >
                  {todo.priority > 0 ? (
                    <span
                      className={styles.prioDot}
                      data-priority={todo.priority}
                      aria-hidden="true"
                    />
                  ) : null}

                  <button
                    className="habit-info-btn"
                    onClick={() => {
                      closeOpenRow();
                      setEditingTask(todo);
                    }}
                    aria-label={`${t("editTask")}: ${todo.title}`}
                    style={{ minHeight: 44 }}
                  >
                    <span className="habit-icon">📝</span>
                    <div className="task-info">
                      <span
                        className={`habit-name${
                          todo.is_completed ? " completed" : ""
                        }`}
                      >
                        {todo.title}
                      </span>
                      <span className={`task-due ${styles.meta}`}>
                        {todo.due_date ? (
                          <span
                            className={`task-due-badge ${
                              isOverdue ? styles.overdue : ""
                            }`}
                          >
                            📅 {describeDueDate(todo.due_date, new Date(), dateI18n)}
                          </span>
                        ) : null}
                        {todo.due_time ? (
                          <span className="task-due-badge">
                            🕒 {todo.due_time}
                          </span>
                        ) : null}
                        {subtaskLabel ? (
                          <span className="task-due-badge">
                            ☑️ {subtaskLabel}
                          </span>
                        ) : null}
                        {(todo.tags ?? []).map((name) => (
                          <span key={name} className={styles.tagChip}>
                            #{name}
                          </span>
                        ))}
                      </span>
                    </div>
                  </button>

                  <button
                    role="checkbox"
                    aria-checked={todo.is_completed}
                    aria-label={`${todo.title}: ${
                      todo.is_completed
                        ? t("habitCompletedLabel")
                        : t("habitNotCompletedLabel")
                    }`}
                    className={`habit-checkbox${
                      todo.is_completed ? " checked" : ""
                    }`}
                    onClick={() => void toggleTodo(todo)}
                    style={{ minHeight: 44, minWidth: 44 }}
                  >
                    {todo.is_completed && <CheckMark />}
                  </button>

                  <button
                    type="button"
                    className={styles.rowMenuBtn}
                    onClick={(e) => {
                      // The row's own tap target sits right beside this one; a
                      // click that reached it would open the editor behind the
                      // menu.
                      e.stopPropagation();
                      openTaskMenu(todo);
                    }}
                    aria-label={`${t("rowActions")}: ${todo.title}`}
                  >
                    ⋯
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <EditTaskSheet
        key={editingTask?.id ?? "empty"}
        task={editingTask}
        onClose={() => setEditingTask(null)}
      />

      <RowActionsSheet
        key={menuTask?.id ?? "empty"}
        target={
          menuTask
            ? {
                id: menuTask.id,
                title: menuTask.title,
                completed: menuTask.is_completed,
                kind: "task",
              }
            : null
        }
        onMarkDone={menuMarkDone}
        onMarkUndone={menuMarkUndone}
        onEdit={menuEdit}
        onDelete={menuDelete}
        onClose={closeRowMenu}
      />
    </div>
  );
}
