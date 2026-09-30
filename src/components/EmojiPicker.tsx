"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { useLanguage } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import { HABIT_ICON_GROUPS, isHabitIcon } from "@/lib/habitIcons";
import styles from "./EmojiPicker.module.css";

/**
 * The habit icon picker: the grouped set from src/lib/habitIcons.ts, one
 * button per icon, rendered inside the create modal and the edit sheet.
 *
 * Presentational on purpose — the parent owns `value` and performs the save,
 * exactly like TagPicker. Taps here only report the icon the user chose.
 */
export interface EmojiPickerProps {
  /** The habit's current icon, whether or not it is in our set. */
  value: string;
  onChange: (icon: string) => void;
  /** Overrides the picker's own label; defaults to the i18n heading. */
  label?: string;
}

export function EmojiPicker({ value, onChange, label }: EmojiPickerProps) {
  const { t } = useLanguage();
  const baseId = useId();
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * Habits saved before this set existed — or written by the bot — can hold any
   * emoji at all, and the server accepts them (`z.string().emoji().max(8)`).
   * So the current icon is NOT assumed to be in the set.
   *
   * When it is not, it gets its own slot above the grid, marked selected. Two
   * things break if that slot is ever "cleaned up" as dead code:
   *
   *   1. Editing an old habit would silently rewrite its icon. Nothing in the
   *      grid matches the stored value, so a save that took its icon from the
   *      grid would persist a default the user never picked.
   *   2. The user could not see what the habit currently is — the set would
   *      show no selection at all, which reads as "no icon set".
   *
   * The empty string is excluded: it is not a valid icon and rendering it
   * would leave an invisible, unlabelled button.
   */
  const unknown = value !== "" && !isHabitIcon(value);

  const select = (icon: string) => {
    haptics.select();
    // Re-tapping the current icon is deliberately a no-op: the value is
    // already right, and reporting a change would let a parent mark itself
    // dirty for an edit the user did not make.
    if (icon !== value) onChange(icon);
  };

  /**
   * Arrow keys move focus across the grid; Home/End jump to the ends.
   *
   * Additive on purpose: every button keeps its natural tab order, so Tab +
   * Enter alone operates the picker and a bug in here can only land focus on
   * an unexpected cell, never put an icon out of reach. (A roving tabindex
   * would remove buttons from the tab order, so a wrong index there would make
   * icons unreachable — not worth it for a bonus affordance.)
   *
   * Rows are read from the live layout because the grid reflows with the
   * sheet's width; a hardcoded column count would be wrong on any resize.
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const { key } = e;
    const isVertical = key === "ArrowUp" || key === "ArrowDown";
    if (
      !isVertical &&
      key !== "ArrowLeft" &&
      key !== "ArrowRight" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }

    const root = gridRef.current;
    if (!root) return;
    // Only the set's own buttons: the "current icon" chip lives outside this
    // container, so arrow keys stay within the grid.
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button")
    );
    const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0 || buttons.length === 0) return;

    let target = from;
    if (key === "ArrowLeft") target = from - 1;
    else if (key === "ArrowRight") target = from + 1;
    else if (key === "Home") target = 0;
    else if (key === "End") target = buttons.length - 1;
    else if (isVertical) {
      const current = buttons[from];
      const down = key === "ArrowDown";
      // The adjacent row is the nearest one in the direction of travel...
      const inDirection = buttons.filter((b) =>
        down
          ? b.offsetTop > current.offsetTop + 1
          : b.offsetTop < current.offsetTop - 1
      );
      if (inDirection.length > 0) {
        const rowTop = inDirection.reduce(
          (acc, b) =>
            down ? Math.min(acc, b.offsetTop) : Math.max(acc, b.offsetTop),
          down ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
        );
        // ...and within it, the cell closest to the one we came from, so a
        // column of taps walks straight down.
        const row = inDirection.filter(
          (b) => Math.abs(b.offsetTop - rowTop) <= 1
        );
        const closest = row.reduce((acc, b) =>
          Math.abs(b.offsetLeft - current.offsetLeft) <
          Math.abs(acc.offsetLeft - current.offsetLeft)
            ? b
            : acc
        );
        target = buttons.indexOf(closest);
      }
    }

    // Clamped rather than wrapped: at the first or last cell the keypress is
    // left to the sheet, so the page still scrolls when the grid cannot move.
    if (target < 0 || target >= buttons.length || target === from) return;
    e.preventDefault();
    buttons[target]?.focus();
  };

  return (
    <div className={styles.wrap} role="group" aria-labelledby={`${baseId}-l`}>
      <span className={styles.label} id={`${baseId}-l`}>
        {label ?? t("iconChoose")}
      </span>

      {unknown ? (
        <div
          className={styles.current}
          role="group"
          aria-labelledby={`${baseId}-c`}
        >
          <span className={styles.currentLabel} id={`${baseId}-c`}>
            {t("iconCurrent")}
          </span>
          <button
            type="button"
            className={`${styles.option} ${styles.selected}`}
            aria-pressed={true}
            /* Emoji as the name, matching how the icon buttons are labelled
               below and how the inline picker labelled them before. */
            aria-label={value}
            onClick={() => select(value)}
          >
            {value}
          </button>
        </div>
      ) : null}

      <div className={styles.scroll} ref={gridRef} onKeyDown={handleKeyDown}>
        {HABIT_ICON_GROUPS.map((group) => (
          <section
            key={group.id}
            className={styles.group}
            role="group"
            aria-labelledby={`${baseId}-${group.id}`}
          >
            <h4 className={styles.groupTitle} id={`${baseId}-${group.id}`}>
              {t(group.labelKey)}
            </h4>
            <div className={styles.grid}>
              {group.icons.map((icon) => {
                const selected = icon === value;
                return (
                  <button
                    key={icon}
                    /* type is load-bearing: the create modal renders this
                       inside a <form>, where the default submit type would
                       save the habit on every icon tap. */
                    type="button"
                    className={`${styles.option}${
                      selected ? ` ${styles.selected}` : ""
                    }`}
                    aria-pressed={selected}
                    aria-label={icon}
                    onClick={() => select(icon)}
                  >
                    {icon}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
