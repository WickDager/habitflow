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

  // Swipe state
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeHandled = useRef(false);

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
        <p className="empty-state">{t("noTasksYet")}</p>
      </div>
    );
  }

  const formatDue = (date: string | null, time: string | null) => {
    if (!date && !time) return null;
    const parts: string[] = [];
    if (date) {
      parts.push(
        new Date(date + "T00:00:00").toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
      );
    }
    if (time) parts.push(time);
    return parts.join(" ");
  };

  return (
    <div className="today-view">
      <ul className="habit-list">
        {todos.map((todo) => (
          <li
            key={todo.id}
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
                if (dx < -40) deleteTodo(todo.id);
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
                  className={`habit-name ${todo.is_completed ? "completed" : ""}`}
                >
                  {todo.title}
                </span>
                {formatDue(todo.due_date, todo.due_time) && (
                  <span className="task-due">
                    {formatDue(todo.due_date, todo.due_time)}
                  </span>
                )}
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
              className={`habit-checkbox ${todo.is_completed ? "checked" : ""}`}
              onClick={() => toggleTodo(todo)}
              style={{ minHeight: 44, minWidth: 44 }}
            >
              {todo.is_completed ? "✓" : ""}
            </button>
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
