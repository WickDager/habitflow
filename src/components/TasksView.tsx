"use client";

import { useCallback, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";
import { HabitSkeleton } from "./HabitSkeleton";
import { EditTaskSheet } from "./EditTaskSheet";

interface Todo {
  id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  is_completed: boolean;
  created_at: string;
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

function formatDueBadge(date: string | null, time: string | null) {
  if (!date && !time) return null;
  const badges: { emoji: string; text: string }[] = [];
  if (date) {
    badges.push({
      emoji: "📅",
      text: new Date(date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    });
  }
  if (time) {
    badges.push({ emoji: "🕒", text: time });
  }
  return badges;
}

export function TasksView() {
  const { mutate } = useSWRConfig();
  const { t } = useLanguage();
  const [editingTask, setEditingTask] = useState<Todo | null>(null);

  const { data: todos, isLoading, error } = useSWR<Todo[]>(
    "/api/todos",
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

  const toggleTodo = useCallback(
    async (todo: Todo) => {
      haptics.medium();

      const optimistic = (todos ?? []).map((t) =>
        t.id === todo.id ? { ...t, is_completed: !t.is_completed } : t
      );

      await mutate("/api/todos", optimistic, false);

      try {
        await apiFetch(`/api/todos/${todo.id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_completed: !todo.is_completed }),
        });
        await mutate("/api/todos");
      } catch {
        haptics.error();
        await mutate("/api/todos");
      }
    },
    [mutate, todos]
  );

  const deleteTodo = useCallback(
    async (todoId: string) => {
      haptics.medium();

      const optimistic = (todos ?? []).filter((t) => t.id !== todoId);
      await mutate("/api/todos", optimistic, false);

      try {
        await apiFetch(`/api/todos/${todoId}`, { method: "DELETE" });
        await mutate("/api/todos");
      } catch {
        haptics.error();
        await mutate("/api/todos");
      }
    },
    [mutate, todos]
  );

  const swipeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const swipeStartX = useRef(0);
  const swipeCurrentX = useRef(0);
  const swipeActiveId = useRef<string | null>(null);

  if (isLoading) return <HabitSkeleton count={3} />;
  if (error)
    return (
      <div className="error-state" role="alert">
        {t("loadingError")}
      </div>
    );

  if (!todos || todos.length === 0) {
    return (
      <div className="today-view">
        <div className="empty-state">
          <span className="empty-state-emoji">📭</span>
          <span className="empty-state-text">{t("noTasksYet")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="today-view">
      <ul className="habit-list">
        {todos.map((todo) => (
          <li key={todo.id} className="swipe-wrapper">
            <div className="swipe-delete-bg" onClick={() => deleteTodo(todo.id)}>Delete</div>
            <div
              className="habit-row"
              ref={(el) => { if (el) swipeRefs.current.set(todo.id, el); }}
              style={todo.is_completed ? { opacity: 0.55 } : undefined}
              onTouchStart={(e) => {
                swipeStartX.current = e.touches[0].clientX;
                swipeActiveId.current = todo.id;
              }}
              onTouchMove={(e) => {
                if (swipeActiveId.current !== todo.id) return;
                let diff = e.touches[0].clientX - swipeStartX.current;
                if (diff > 0) diff = 0;
                if (diff < -100) diff = -100;
                swipeCurrentX.current = diff;
                const el = swipeRefs.current.get(todo.id);
                if (el) el.style.transform = `translateX(${diff}px)`;
              }}
              onTouchEnd={() => {
                if (swipeActiveId.current !== todo.id) return;
                swipeActiveId.current = null;
                const el = swipeRefs.current.get(todo.id);
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
                onClick={() => setEditingTask(todo)}
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
                  <span className="task-due">
                    {formatDueBadge(todo.due_date, todo.due_time)?.map(
                      (b, i) => (
                        <span key={i} className="task-due-badge">
                          {b.emoji} {b.text}
                        </span>
                      )
                    )}
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
                onClick={() => toggleTodo(todo)}
                style={{ minHeight: 44, minWidth: 44 }}
              >
                {todo.is_completed && <CheckMark />}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <EditTaskSheet
        key={editingTask?.id ?? "empty"}
        task={editingTask}
        onClose={() => setEditingTask(null)}
      />
    </div>
  );
}
