"use client";

import { useState, useRef, useEffect } from "react";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";

type CreateType = "habit" | "task" | null;

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
}

const EMOJIS = ["🏃", "📚", "💧", "🧘", "💤", "🍎", "✍️", "🎯", "💻", "🧹"];

export function CreateModal({ open, onClose }: CreateModalProps) {
  const { t } = useLanguage();
  const { mutate } = useSWRConfig();
  const [step, setStep] = useState<CreateType>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🏃");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      haptics.select();
      setStep(null);
      setName("");
      setIcon("🏃");
      setTitle("");
      setDueDate("");
      setError("");
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
      await mutate("/api/checkins?date=" + new Date().toISOString().slice(0, 10));
      onClose();
    } catch {
      haptics.error();
      setError(t("saveFailed"));
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
      await apiFetch("/api/todos", {
        method: "POST",
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
