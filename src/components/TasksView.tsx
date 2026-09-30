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

  const toggleTodo = useCallback(
    async (todo: Todo) => {
      haptics.medium();

      const optimistic = (todos ?? []).map((item) =>
        item.id === todo.id ? { ...item, is_completed: !item.is_completed } : item
      );
      await mutate(listKey, optimistic, false);

      try {
        await apiFetch(`/api/todos/${todo.id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_completed: !todo.is_completed }),
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
      setOpenId(null);

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
    [listKey, mutate, refresh, restoreTodo, t, toast, todos]
  );

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const swipeStartX = useRef(0);
  const swipeCurrentX = useRef(0);
  const swipeActiveId = useRef<string | null>(null);

  const setRowOffset = (id: string, offset: number) => {
    const el = rowRefs.current.get(id);
    if (el) el.style.transform = `translateX(${offset}px)`;
  };

  const closeOpenRow = () => {
    if (openId) setRowOffset(openId, 0);
    setOpenId(null);
  };

  const list = todos ?? [];
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
            const open = openId === todo.id;

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
                    if (el) rowRefs.current.set(todo.id, el);
                  }}
                  style={todo.is_completed ? { opacity: 0.55 } : undefined}
                  onTouchStart={(e) => {
                    if (openId && openId !== todo.id) closeOpenRow();
                    swipeStartX.current = e.touches[0].clientX;
                    swipeCurrentX.current = 0;
                    swipeActiveId.current = todo.id;
                    // .habit-row transitions transform over 200ms, which makes
                    // the row lag behind the finger; dragging turns it off.
                    rowRefs.current
                      .get(todo.id)
                      ?.classList.add(styles.swipeDragging);
                  }}
                  onTouchMove={(e) => {
                    if (swipeActiveId.current !== todo.id) return;
                    const base = openId === todo.id ? -REVEAL_PX : 0;
                    let diff = e.touches[0].clientX - swipeStartX.current + base;
                    if (diff > 0) diff = 0;
                    if (diff < -REVEAL_PX) diff = -REVEAL_PX;
                    swipeCurrentX.current = diff;
                    setRowOffset(todo.id, diff);
                  }}
                  onTouchEnd={() => {
                    if (swipeActiveId.current !== todo.id) return;
                    swipeActiveId.current = null;
                    rowRefs.current
                      .get(todo.id)
                      ?.classList.remove(styles.swipeDragging);
                    const shouldOpen = swipeCurrentX.current < -REVEAL_PX / 2;
                    setRowOffset(todo.id, shouldOpen ? -REVEAL_PX : 0);
                    setOpenId(shouldOpen ? todo.id : null);
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
    </div>
  );
}
