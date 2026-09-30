"use client";

import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";
import { useEscapeToClose, useSheetDrag } from "./useSheetDrag";
import styles from "./FocusPicker.module.css";

/**
 * The sheet behind "Focus today".
 *
 * Picks apply the moment they are tapped — there is nothing to stage — so the
 * footer button only dismisses. Keep it that way: a "Save" that had to be
 * pressed after every tap would make the max-3 limit feel like a rule to
 * discover rather than feedback you get as you go.
 */

interface FocusHabit {
  id: string;
  name: string;
  icon: string;
  streak: number;
}

interface FocusPickerProps {
  open: boolean;
  habits: FocusHabit[];
  /** The habits pinned for the day, in pin order. */
  focusIds: string[];
  limit: number;
  onToggle: (habitId: string) => void;
  onClose: () => void;
}

export function FocusPicker({
  open,
  habits,
  focusIds,
  limit,
  onToggle,
  onClose,
}: FocusPickerProps) {
  const { t } = useLanguage();
  // The drag on the handle joins the overlay, the Save button and Escape.
  const { sheetRef, dragStyle, handleProps } = useSheetDrag({ open, onClose });
  // Desktop Telegram Web: Escape is the expected way out of a sheet.
  useEscapeToClose(onClose, open);

  if (!open) return null;

  const atLimit = focusIds.length >= limit;

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="bottom-sheet"
        ref={sheetRef}
        style={dragStyle}
        role="dialog"
        aria-modal="true"
        aria-label={t("focusToday")}
      >
        <div className="sheet-handle" {...handleProps} />

        <div className={styles.head}>
          <h3 className={styles.title}>{t("focusToday")}</h3>
          <span className={styles.count}>
            {focusIds.length} / {limit}
          </span>
        </div>
        <p className={styles.hint}>{t("focusHint")}</p>

        {habits.length === 0 ? (
          <p className={styles.hint}>{t("noHabitsYet")}</p>
        ) : (
          <ul className={styles.list}>
            {habits.map((habit) => {
              const pinned = focusIds.includes(habit.id);
              // At the limit the extra rows still take the tap: the handler
              // answers with the focusLimitReached toast, which teaches the
              // rule. A disabled button would just feel broken.
              const blocked = atLimit && !pinned;
              return (
                <li key={habit.id}>
                  <button
                    className={`${styles.row}${pinned ? ` ${styles.pinned}` : ""}${
                      blocked ? ` ${styles.blocked}` : ""
                    }`}
                    aria-pressed={pinned}
                    onClick={() => {
                      haptics.select();
                      onToggle(habit.id);
                    }}
                    style={{ minHeight: 44 }}
                  >
                    <span className={styles.icon} aria-hidden="true">
                      {habit.icon}
                    </span>
                    <span className={styles.name}>{habit.name}</span>
                    {habit.streak > 0 ? (
                      <span className={styles.streak}>🔥 {habit.streak}</span>
                    ) : null}
                    <span className={styles.check} aria-hidden="true">
                      {pinned ? "✓" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="sheet-actions">
          <button
            className="sheet-submit-btn"
            onClick={onClose}
            style={{ minHeight: 44 }}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </>
  );
}
