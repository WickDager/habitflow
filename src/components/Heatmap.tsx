"use client";

import { useLanguage } from "@/lib/i18n";
import { parseDateString, todayLocal } from "@/lib/dates";
// Type-only import: erased at compile time, so pulling the shape from the report
// module does not drag `next/og` into the client bundle.
import type { HeatmapCell } from "@/lib/reportImage";
import styles from "./Heatmap.module.css";

/**
 * GitHub-style activity grid: one row per weekday (Sunday first, matching the
 * 0=Sunday convention `/api/insights` uses for `bestWeekday`), one column per
 * week. Colour intensity is the share of that day's habits that were completed.
 */

/** Fixed reference week — 2024-01-07 was a Sunday, so i = 0..6 gives Sun..Sat. */
const WEEK_START = new Date(2024, 0, 7, 12, 0, 0, 0);

/** 0 = nothing done, 4 = everything done. */
function intensity(count: number, total: number): number {
  if (total <= 0 || count <= 0) return 0;
  const ratio = Math.min(1, count / total);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function Heatmap({ days }: { days: HeatmapCell[] }) {
  const { t, lang } = useLanguage();
  if (days.length === 0) return null;

  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const firstWeekday = parseDateString(days[0].date).getDay();
  const weeks = Math.max(1, Math.ceil((firstWeekday + days.length) / 7));
  const today = todayLocal();

  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Date(
      WEEK_START.getFullYear(),
      WEEK_START.getMonth(),
      WEEK_START.getDate() + i,
      12
    ).toLocaleDateString(locale, { weekday: "narrow" })
  );

  // Leading blanks push the first day onto its real weekday row, so a column is
  // a calendar week and the eye can compare "all Mondays" down a row.
  const cells: (HeatmapCell | null)[] = Array.from(
    { length: weeks * 7 },
    (_, i) => (i < firstWeekday ? null : (days[i - firstWeekday] ?? null))
  );

  return (
    <div className={styles.board}>
      <div className={styles.labels} aria-hidden="true">
        {weekdayNames.map((name, i) => (
          <span key={i} className={styles.label}>
            {name}
          </span>
        ))}
      </div>

      <div
        className={styles.grid}
        style={{ aspectRatio: `${weeks} / 7` }}
      >
        {cells.map((day, i) =>
          day === null ? (
            <span key={`blank-${i}`} className={styles.blank} aria-hidden="true" />
          ) : (
            <span
              key={day.date}
              role="img"
              className={`${styles.cell} ${styles[`level${intensity(day.count, day.total)}`]} ${
                day.date === today ? styles.today : ""
              }`}
              style={{ animationDelay: `${i * 12}ms` }}
              aria-label={cellLabel(day)}
              title={cellLabel(day)}
            />
          )
        )}
      </div>

      {/* Numeric ends, so the ramp needs no English (or Russian) wording. The
          per-cell labels above already carry the real information. */}
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendEnd}>0%</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`${styles.swatch} ${styles[`level${level}`]}`}
          />
        ))}
        <span className={styles.legendEnd}>100%</span>
      </div>
    </div>
  );

  /** e.g. "12 Sep — 3 of 5 completed (60%)", built from existing keys. */
  function cellLabel(day: HeatmapCell): string {
    const dateLabel = parseDateString(day.date).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
    });
    // No habits existed yet on this day, so there is no ratio to report.
    if (day.total <= 0) return dateLabel;
    const pct = Math.round((Math.min(1, day.count / day.total)) * 100);
    return `${dateLabel} — ${t("habitsCompleted", {
      count: day.count,
      total: day.total,
      pct,
    })}`;
  }
}
