"use client";

import { useState, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";

interface Habit {
  id: string;
  name: string;
  icon: string;
}

interface EditHabitSheetProps {
  habit: Habit | null;
  onClose: () => void;
}

const EMOJIS = ["🏃", "📚", "💧", "🧘", "💤", "🍎", "✍️", "🎯", "💻", "🧹"];

export function EditHabitSheet({ habit, onClose }: EditHabitSheetProps) {
  const { t } = useLanguage();
  const { mutate } = useSWRConfig();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (habit) {
      setName(habit.name);
      setIcon(habit.icon);
      setError("");
      setShowDeleteConfirm(false);
      haptics.select();
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [habit]);

  if (!habit) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/habits/${habit.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), icon }),
      });
      haptics.success();
      const today = new Date().toISOString().slice(0, 10);
      await mutate(`/api/checkins?date=${today}`);
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
      await apiFetch(`/api/habits/${habit.id}`, { method: "DELETE" });
      haptics.success();
      const today = new Date().toISOString().slice(0, 10);
      await mutate(`/api/checkins?date=${today}`);
      await mutate("/api/checkins/stats");
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
          <h3 className="sheet-form-title">{t("editHabit")}</h3>
          <input
            ref={nameRef}
            className="sheet-input"
            type="text"
            placeholder={t("habitNameLabel")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
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
              onClick={onClose}
              style={{ minHeight: 44 }}
            >
              {t("cancel")}
            </button>
            <button
              className="sheet-submit-btn"
              onClick={handleSave}
              disabled={saving || !name.trim()}
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
              {t("deleteHabit")}
            </button>
          ) : (
            <div className="delete-confirm">
              <p className="delete-confirm-text">{t("deleteHabitConfirm")}</p>
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
