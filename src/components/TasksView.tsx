"use client";

import { useCallback, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";
import { HabitSkeleton } from "./HabitSkeleton";

interface Todo {
  id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  is_completed: boolean;
  created_at: string;
}

export function TasksView() {
  const { mutate } = useSWRConfig();
  const { t } = useLanguage();

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
            }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - touchStartX.current;
              const dy = e.changedTouches[0].clientY - touchStartY.current;
              if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < -60) deleteTodo(todo.id);
              }
            }}
          >
            <span className="habit-icon">📝</span>
            <div className="task-info">
              <span
                className={`habit-name ${todo.is_completed ? "completed" : ""}`}
              >
                {todo.title}
              </span>
              {todo.due_date && (
                <span className="task-due">
                  {new Date(todo.due_date + "T00:00:00").toLocaleDateString(
                    undefined,
                    { month: "short", day: "numeric" }
                  )}
                </span>
              )}
            </div>
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
    </div>
  );
}
