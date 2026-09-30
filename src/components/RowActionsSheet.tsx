"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLanguage } from "@/lib/i18n";
import { useEscapeToClose, useSheetDrag } from "./useSheetDrag";
import styles from "./RowActionsSheet.module.css";

/**
 * The row menu — what used to live underneath a swipe, reachable with a click.
 *
 * Every action a row offers was either invisible or one gesture deep: Delete
 * sat under the row behind a swipe-to-reveal layer, and the only other route
 * to it was the edit sheet's button at the bottom. On Telegram Web — where a
 * mouse cannot swipe, and where the row's own tap opens the editor — deleting
 * a habit meant opening its editor and scrolling. The "⋯" at the end of every
 * row opens this instead.
 *
 * Presentational on purpose: it owns no requests and no cache keys. Each
 * caller passes the handlers that already exist for its own rows (the habits
 * and tasks on My Day are refreshed by different keys than the task list is),
 * so the sheet stays a place to decide *what* to do, not a second place to
 * know how. Callers close it in the handler they hand over.
 */

export interface RowActionTarget {
  /** The row this menu belongs to — used as a React key by the callers. */
  id: string;
  /** Shown under the heading, so it is obvious which row is being acted on. */
  title: string;
  /** Decides which of Mark done / Mark undone is offered. */
  completed: boolean;
  /** Picks the edit label, and which API the caller has to talk to. */
  kind: "habit" | "task";
}

export interface RowActionsSheetProps {
  target: RowActionTarget | null;
  onMarkDone: () => void;
  onMarkUndone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function RowActionsSheet({
  target,
  onMarkDone,
  onMarkUndone,
  onEdit,
  onDelete,
  onClose,
}: RowActionsSheetProps) {
  const { t } = useLanguage();
  const { sheetRef: dragRef, dragStyle, handleProps } = useSheetDrag({
    // This component unmounts when closed rather than hiding, so `open` is
    // simply whether there is a row to act on.
    open: target !== null,
    onClose,
  });
  const sheetRef = useRef<HTMLDivElement>(null);

  // One DOM node, two refs. The drag hook needs its own handle to write
  // transforms onto, and the dialog needs focus on open; React takes a single
  // `ref` prop, so they are composed here.
  const setSheetNode = useCallback(
    (el: HTMLDivElement | null) => {
      dragRef.current = el;
      sheetRef.current = el;
    },
    [dragRef]
  );

  useEscapeToClose(onClose, target !== null);

  useEffect(() => {
    // The sheet slides up over 250ms, so focus is moved once it has landed.
    // Callers key this component by the row's id, which means the effect runs
    // on the mount that *has* a row: without it, a keyboard would stay on the
    // ⋯ button and the next Tab would walk into the row behind the sheet.
    // The dialog itself takes the focus rather than the first option, because
    // one of those two options is always disabled and a disabled button cannot
    // hold focus.
    const timer = setTimeout(() => sheetRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  if (!target) return null;

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={setSheetNode}
        style={dragStyle}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("rowActions")}
        tabIndex={-1}
      >
        <div className="sheet-handle" {...handleProps} />

        <div className="sheet-form">
          <h3 className="sheet-form-title">{t("rowActions")}</h3>
          <p className={styles.subject}>{target.title}</p>

          <div className="sheet-options">
            {/* Both verbs stay on screen rather than swapping one for the
                other: the state a row is in is then readable from the menu,
                and the greyed one is the answer to "did the tick take?" —
                which is the whole question on Telegram Web, where the haptic
                that would have answered it is a no-op. */}
            <button
              type="button"
              className="sheet-option-btn"
              onClick={onMarkDone}
              disabled={target.completed}
              style={{ minHeight: 44 }}
            >
              <span className="sheet-option-icon" aria-hidden="true">
                ✓
              </span>
              <span className="sheet-option-label">{t("markDone")}</span>
            </button>

            <button
              type="button"
              className="sheet-option-btn"
              onClick={onMarkUndone}
              disabled={!target.completed}
              style={{ minHeight: 44 }}
            >
              <span className="sheet-option-icon" aria-hidden="true">
                ↩
              </span>
              <span className="sheet-option-label">{t("markUndone")}</span>
            </button>

            <button
              type="button"
              className="sheet-option-btn"
              onClick={onEdit}
              style={{ minHeight: 44 }}
            >
              <span className="sheet-option-icon" aria-hidden="true">
                ✎
              </span>
              <span className="sheet-option-label">
                {target.kind === "habit" ? t("editHabit") : t("editTask")}
              </span>
            </button>

            <button
              type="button"
              className={`sheet-option-btn ${styles.danger}`}
              onClick={onDelete}
              style={{ minHeight: 44 }}
            >
              <span className="sheet-option-icon" aria-hidden="true">
                🗑
              </span>
              <span className="sheet-option-label">{t("delete")}</span>
            </button>
          </div>

          <div className="sheet-actions">
            <button
              type="button"
              className="sheet-cancel-btn"
              onClick={onClose}
              style={{ minHeight: 44 }}
            >
              {t("close")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
