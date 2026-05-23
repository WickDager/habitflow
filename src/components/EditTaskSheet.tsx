"use client";

import { useState, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";

interface Todo {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  is_completed: boolean;
}

interface EditTaskSheetProps {
  task: Todo | null;
  onClose: () => void;
}

export function EditTaskSheet({ task, onClose }: EditTaskSheetProps) {
  const { t } = useLanguage();
  const { mutate } = useSWRConfig();
  const [title, setTitle] = useState(task?.title ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [dueTime, setDueTime] = useState(task?.due_time ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    haptics.select();
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  if (!task) return null;

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const body: Record<string, string | null> = { title: title.trim() };
      body.due_date = dueDate || null;
      body.due_time = dueTime || null;
      await apiFetch(`/api/todos/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      haptics.success();
      await mutate("/api/todos");
      onClose();
    } catch {
      haptics.error();
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await apiFetch(`/api/todos/${task.id}`, { method: "DELETE" });
      haptics.success();
      await mutate("/api/todos");
      onClose();
    } catch {
      haptics.error();
      setError(t("saveFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div
        className="sheet-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="bottom-sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />

        <div className="sheet-form">
          <h3 className="sheet-form-title">{t("editTask")}</h3>
          <input
            ref={titleRef}
            className="sheet-input"
            type="text"
            placeholder={t("taskTitle")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <label className="sheet-date-label">
            <span>{t("taskDueDate")}</span>
            <input
              className="sheet-input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="sheet-date-label">
            <span>{t("taskDueTime")}</span>
            <input
              className="sheet-input"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </label>

          {error && <p className="sheet-error">{error}</p>}

          <div className="sheet-actions">
            <button
              className="sheet-cancel-btn"
              onClick={onClose}
              style={{ minHeight: 44 }}
            >
              {t("cancel")}
            </button>
            <button
              className="sheet-submit-btn"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              style={{ minHeight: 44 }}
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>

          {!showDeleteConfirm ? (
            <button
              className="sheet-delete-btn"
              onClick={() => {
                haptics.medium();
                setShowDeleteConfirm(true);
              }}
              style={{ minHeight: 44 }}
            >
              {t("deleteTask")}
            </button>
          ) : (
            <div className="delete-confirm">
              <p className="delete-confirm-text">{t("deleteTaskConfirm")}</p>
              <div className="sheet-actions">
                <button
                  className="sheet-cancel-btn"
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{ minHeight: 44 }}
                >
                  {t("cancel")}
                </button>
                <button
                  className="sheet-delete-confirm-btn"
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{ minHeight: 44 }}
                >
                  {deleting ? t("saving") : t("delete")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
