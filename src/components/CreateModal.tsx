"use client";

import { useState, useRef, useEffect } from "react";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { useToast } from "@/components/Toast";
import { useLanguage } from "@/lib/i18n";
import { todayLocal } from "@/lib/dates";

type CreateType = "habit" | "task" | null;

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
}

const EMOJIS = ["🏃", "📚", "💧", "🧘", "💤", "🍎", "✍️", "🎯", "💻", "🧹"];

export function CreateModal({ open, onClose }: CreateModalProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { mutate } = useSWRConfig();
  const [step, setStep] = useState<CreateType>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🏃");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      haptics.select();
    }
  }, [open]);

  useEffect(() => {
    if (step === "habit") {
      setTimeout(() => nameRef.current?.focus(), 100);
    } else if (step === "task") {
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [step]);

  const handleCreateHabit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/habits", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), icon }),
      });
      haptics.success();
      // todayLocal(), not the UTC day: this string is an SWR cache key, and
      // the Today view fetches with its own local date. A UTC key silently
      // misses the cache and leaves the new habit invisible until reload.
      await mutate("/api/checkins?date=" + todayLocal());
      // The Focus chips render from /api/day, so without this a habit created
      // here is missing from the Focus picker until a reload.
      await mutate(`/api/day?date=${todayLocal()}`);
      // There is no "habit added" key to use here; the generic success string
      // is what this path has. The toast matters because the modal closing is
      // otherwise the only signal, and on Telegram Web haptics are a no-op.
      toast(t("habitAdded"), { kind: "success" });
      onClose();
    } catch (err) {
      haptics.error();
      setError(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTask = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const body: Record<string, string> = { title: title.trim() };
      if (dueDate) body.due_date = dueDate;
      if (dueTime) body.due_time = dueTime;
      await apiFetch("/api/todos", {
        method: "POST",
        body: JSON.stringify(body),
      });
      haptics.success();
      // A function matcher, not "/api/todos": the todo lists are all
      // subscribed to under a query string (/api/todos?filter=all), and a
      // string key only ever matches itself, so the old call revalidated
      // nothing and the new task stayed invisible until a tab switch.
      await mutate(
        (key) => typeof key === "string" && key.startsWith("/api/todos")
      );
      // The Today tab's task section reads /api/day, a different key again.
      await mutate(`/api/day?date=${todayLocal()}`);
      // Visible confirmation: without it a successful save looks exactly like
      // nothing happening, which is how duplicate tasks get created.
      toast(t("taskAdded"), { kind: "success" });
      onClose();
    } catch (err) {
      haptics.error();
      setError(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} aria-hidden="true" />
      <div className="bottom-sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />

        {!step ? (
          <div className="sheet-options">
            <button
              className="sheet-option-btn"
              onClick={() => setStep("habit")}
              style={{ minHeight: 52 }}
            >
              <span className="sheet-option-icon">✅</span>
              <span className="sheet-option-label">{t("newHabit")}</span>
            </button>
            <button
              className="sheet-option-btn"
              onClick={() => setStep("task")}
              style={{ minHeight: 52 }}
            >
              <span className="sheet-option-icon">📝</span>
              <span className="sheet-option-label">{t("newTask")}</span>
            </button>
          </div>
        ) : step === "habit" ? (
          <div className="sheet-form">
            <h3 className="sheet-form-title">{t("newHabit")}</h3>
            <input
              ref={nameRef}
              className="sheet-input"
              type="text"
              placeholder={t("habitNameLabel")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              onKeyDown={(e) => e.key === "Enter" && handleCreateHabit()}
            />
            <div className="emoji-picker">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  className={`emoji-option ${icon === e ? "selected" : ""}`}
                  onClick={() => setIcon(e)}
                  aria-label={e}
                  style={{ minHeight: 44, minWidth: 44 }}
                >
                  {e}
                </button>
              ))}
            </div>
            {error && <p className="sheet-error">{error}</p>}
            <div className="sheet-actions">
              <button
                className="sheet-cancel-btn"
                onClick={() => setStep(null)}
                style={{ minHeight: 44 }}
              >
                {t("cancel")}
              </button>
              <button
                className="sheet-submit-btn"
                onClick={handleCreateHabit}
                disabled={saving || !name.trim()}
                style={{ minHeight: 44 }}
              >
                {saving ? t("saving") : t("saveCheckin")}
              </button>
            </div>
          </div>
        ) : (
          <div className="sheet-form">
            <h3 className="sheet-form-title">{t("newTask")}</h3>
            <input
              ref={titleRef}
              className="sheet-input"
              type="text"
              placeholder={t("taskTitle")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
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
                onClick={() => setStep(null)}
                style={{ minHeight: 44 }}
              >
                {t("cancel")}
              </button>
              <button
                className="sheet-submit-btn"
                onClick={handleCreateTask}
                disabled={saving || !title.trim()}
                style={{ minHeight: 44 }}
              >
                {saving ? t("saving") : t("saveCheckin")}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
