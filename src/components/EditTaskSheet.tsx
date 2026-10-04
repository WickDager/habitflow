"use client";

import { useState, useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";
import { parseDateString, toDateString } from "@/lib/dates";
import { useToast } from "@/components/Toast";
import { TagPicker } from "./TagPicker";
import { useEscapeToClose, useSheetDrag } from "./useSheetDrag";
import type { Recurrence, Subtask, TagRow } from "@/lib/database.types";
import styles from "./EditTaskSheet.module.css";

interface Todo {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  is_completed: boolean;
  priority: number;
  notes: string | null;
  subtasks: Subtask[] | null;
  recurrence: Recurrence | null;
  tags?: string[];
}

interface EditTaskSheetProps {
  task: Todo | null;
  onClose: () => void;
}

type Freq = "never" | "daily" | "weekly" | "monthly";

const PRIORITIES = [
  { value: 0, key: "priorityNone" },
  { value: 1, key: "priorityLow" },
  { value: 2, key: "priorityMedium" },
  { value: 3, key: "priorityHigh" },
];

const FREQS: { value: Freq; key: string }[] = [
  { value: "never", key: "repeatNever" },
  { value: "daily", key: "repeatDaily" },
  { value: "weekly", key: "repeatWeekly" },
  { value: "monthly", key: "repeatMonthly" },
];

/** Subtask ids only have to be unique inside their todo. */
function makeSubtaskId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function EditTaskSheet({ task, onClose }: EditTaskSheetProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { mutate } = useSWRConfig();
  // No `open` prop: a task in hand is what "open" means and the sheet renders
  // null without one.
  const { sheetRef, dragStyle, handleProps } = useSheetDrag({
    open: task !== null,
    onClose,
  });
  useEscapeToClose(onClose, task !== null);

  const [title, setTitle] = useState(task?.title ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [dueTime, setDueTime] = useState(task?.due_time ?? "");
  const [priority, setPriority] = useState(task?.priority ?? 0);
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [subtasks, setSubtasks] = useState<Subtask[]>(task?.subtasks ?? []);
  const [freq, setFreq] = useState<Freq>(task?.recurrence?.freq ?? "never");
  const [tagNames, setTagNames] = useState<string[]>(task?.tags ?? []);
  const [draftSubtask, setDraftSubtask] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const { data: allTags } = useSWR<TagRow[]>("/api/tags", apiFetch, {
    fallbackData: [],
  });

  useEffect(() => {
    haptics.select();
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  if (!task) return null;

  const refreshLists = () =>
    mutate((key) => typeof key === "string" && key.startsWith("/api/todos"));

  /** Anchor a new weekly/monthly rule on the task's own date. */
  const buildRecurrence = (next: Freq): Recurrence | null => {
    if (next === "never") return null;
    // Saving without touching the repeat setting must not rewrite the rule:
    // a stored weekly rule can carry several weekdays.
    if (task.recurrence?.freq === next) return task.recurrence;
    const base = dueDate || toDateString(new Date());
    const parsed = parseDateString(base);
    if (next === "weekly")
      return { freq: "weekly", byday: [parsed.getDay()] };
    if (next === "monthly")
      return { freq: "monthly", bymonthday: parsed.getDate() };
    return { freq: "daily" };
  };

  const handleCreateTag = async (name: string) => {
    try {
      await apiFetch("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await mutate("/api/tags");
      setTagNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    } catch (err) {
      toast(errorMessage(err, t), { kind: "error" });
    }
  };

  const toggleTag = (name: string) => {
    setTagNames((prev) =>
      prev.includes(name) ? prev.filter((tag) => tag !== name) : [...prev, name],
    );
  };

  const addSubtask = () => {
    const value = draftSubtask.trim();
    if (!value) return;
    setSubtasks((prev) => [
      ...prev,
      { id: makeSubtaskId(), title: value, done: false },
    ]);
    setDraftSubtask("");
  };

  const toggleSubtask = (id: string) => {
    setSubtasks((prev) =>
      prev.map((subtask) =>
        subtask.id === id ? { ...subtask, done: !subtask.done } : subtask
      )
    );
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/todos/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          // Explicit nulls, not omissions: the columns are nullable, clearing
          // a date has to be distinguishable from "leave it alone", and
          // TodoSchema marks every nullable field .nullish() so null is
          // accepted. (The old .optional()-only schema rejected this with a
          // 400 — no task without a due date could be saved.)
          due_date: dueDate || null,
          due_time: dueTime || null,
          priority,
          notes: notes.trim() ? notes.trim() : null,
          subtasks,
          recurrence: buildRecurrence(freq),
          tags: tagNames,
        }),
      });
      haptics.success();
      await refreshLists();
      onClose();
    } catch (err) {
      haptics.error();
      setError(errorMessage(err, t));
      toast(errorMessage(err, t), { kind: "error" });
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
      await refreshLists();
      onClose();
    } catch (err) {
      haptics.error();
      setError(errorMessage(err, t));
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="bottom-sheet"
        ref={sheetRef}
        style={dragStyle}
        role="dialog"
        aria-modal="true"
      >
        <div className="sheet-handle" {...handleProps} />

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
            dir="auto"
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

          <div className="sheet-date-label">
            <span>{t("priorityLabel")}</span>
            <div className={styles.prioRow} role="group" aria-label={t("priorityLabel")}>
              {PRIORITIES.map(({ value, key }) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.prioBtn} ${
                    priority === value ? styles.prioBtnActive : ""
                  }`}
                  aria-pressed={priority === value}
                  onClick={() => setPriority(value)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>

          <label className="sheet-date-label">
            <span>{t("repeatLabel")}</span>
            <select
              className={`sheet-input ${styles.select}`}
              value={freq}
              onChange={(e) => setFreq(e.target.value as Freq)}
            >
              {FREQS.map(({ value, key }) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </label>

          <label className="sheet-date-label">
            <span>{t("notesLabel")}</span>
            <textarea
              className={`sheet-input ${styles.notes}`}
              value={notes}
              placeholder={t("notesPlaceholder")}
              maxLength={2000}
              dir="auto"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          <div className="sheet-date-label">
            <span>{t("subtasksLabel")}</span>
            {subtasks.length > 0 ? (
              <ul className={styles.subtaskList}>
                {subtasks.map((subtask) => (
                  <li key={subtask.id} className={styles.subtaskRow}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={subtask.done}
                      className={`${styles.subtaskToggle} ${
                        subtask.done ? styles.subtaskDone : ""
                      }`}
                      onClick={() => toggleSubtask(subtask.id)}
                    >
                      {subtask.done ? "☑" : "☐"}
                    </button>
                    <span
                      className={`${styles.subtaskTitle} ${
                        subtask.done ? styles.subtaskTitleDone : ""
                      }`}
                    >
                      {subtask.title}
                    </span>
                    <button
                      type="button"
                      className={styles.subtaskRemove}
                      aria-label={`${t("delete")}: ${subtask.title}`}
                      onClick={() =>
                        setSubtasks((prev) =>
                          prev.filter((item) => item.id !== subtask.id)
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.subtaskAddRow}>
              <input
                className={`sheet-input ${styles.subtaskInput}`}
                type="text"
                value={draftSubtask}
                placeholder={t("addSubtask")}
                aria-label={t("addSubtask")}
                maxLength={200}
                dir="auto"
                onChange={(e) => setDraftSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  // Enter adds a step rather than saving the whole sheet.
                  e.preventDefault();
                  addSubtask();
                }}
              />
              <button
                type="button"
                className={styles.subtaskAddBtn}
                onClick={addSubtask}
                disabled={!draftSubtask.trim()}
              >
                +
              </button>
            </div>
          </div>

          <div className="sheet-date-label">
            <span>{t("tagsLabel")}</span>
            <TagPicker
              tags={allTags ?? []}
              selected={tagNames}
              onToggle={toggleTag}
              onCreate={handleCreateTag}
            />
          </div>

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
