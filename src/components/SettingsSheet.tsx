"use client";

import { useId, useMemo, useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { isKindEnabled, isQuietHour } from "@/lib/reminders";
import { toTimeString } from "@/lib/dates";
import type { ReminderKinds } from "@/lib/database.types";
import { useEscapeToClose, useSheetDrag } from "./useSheetDrag";
import styles from "./SettingsSheet.module.css";

/**
 * Reminder preferences.
 *
 * Mounted by page.tsx as <SettingsSheet open={} onClose={} />; renders null
 * while closed. Edits stay local until Save, which PATCHes /api/settings and
 * drops them again if the server refuses them.
 *
 * Feedback is a toast and an inline line, never haptics: on Telegram Web
 * window.Telegram is absent, so haptics are silent no-ops there.
 */

/** The /api/settings response — see toSettings() in the route for the source. */
interface SettingsResponse {
  reminder_enabled: boolean;
  reminder_kinds: ReminderKinds;
  morning_hour: number;
  evening_hour: number;
  reminder_hour: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  max_daily_messages: number;
  timezone: string;
  localTime: string;
}

/** What the form edits: the response flattened to booleans and hour ints. */
interface Draft {
  enabled: boolean;
  morning: boolean;
  nudge: boolean;
  evening: boolean;
  weekly: boolean;
  morningHour: number;
  nudgeHour: number;
  eveningHour: number;
  quietStart: number;
  quietEnd: number;
  maxPerDay: number;
  /** Read-only, shown in the timezone line: displayed, never edited. */
  timezone: string;
  localTime: string;
}

function toDraft(s: SettingsResponse): Draft {
  return {
    enabled: s.reminder_enabled,
    // A missing key means "on": isKindEnabled() only treats an explicit false
    // as off, so mirroring that here keeps the switches showing what fires.
    morning: s.reminder_kinds?.morning !== false,
    nudge: s.reminder_kinds?.nudge !== false,
    evening: s.reminder_kinds?.evening !== false,
    weekly: s.reminder_kinds?.weekly !== false,
    morningHour: s.morning_hour,
    nudgeHour: s.reminder_hour,
    eveningHour: s.evening_hour,
    quietStart: s.quiet_hours_start,
    quietEnd: s.quiet_hours_end,
    maxPerDay: s.max_daily_messages,
    timezone: s.timezone,
    localTime: s.localTime,
  };
}

function toPatch(d: Draft) {
  return {
    reminder_enabled: d.enabled,
    reminder_kinds: {
      morning: d.morning,
      nudge: d.nudge,
      evening: d.evening,
      weekly: d.weekly,
    },
    morning_hour: d.morningHour,
    // reminder_hour is the legacy daily-reminder hour: it is the nudge slot.
    reminder_hour: d.nudgeHour,
    evening_hour: d.eveningHour,
    quiet_hours_start: d.quietStart,
    quiet_hours_end: d.quietEnd,
    max_daily_messages: d.maxPerDay,
  };
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MAX_PER_DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Hour int → the "HH:MM" an <input type="time"> speaks. */
const hourToTime = (hour: number) => toTimeString(hour, 0);

/**
 * "HH:MM" → hour int. The columns are hour-only, so minutes are dropped rather
 * than rounded; an emptied or malformed value keeps the previous hour.
 */
function timeToHour(value: string, fallback: number): number {
  const hour = Number.parseInt(value.slice(0, 2), 10);
  if (!Number.isFinite(hour)) return fallback;
  return Math.min(23, Math.max(0, hour));
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      // The hint lives inside the button, so name it explicitly: without this
      // the accessible name reads as the label and the hint run together.
      aria-label={label}
      className={`${styles.row}${checked ? ` ${styles.rowOn}` : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {hint ? <span className={styles.rowHint}>{hint}</span> : null}
      </span>
      <span
        className={`${styles.switch}${checked ? ` ${styles.switchOn}` : ""}`}
        aria-hidden="true"
      >
        <span
          className={`${styles.knob}${checked ? ` ${styles.knobOn}` : ""}`}
        />
      </span>
    </button>
  );
}

export function SettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // The body holds the subscription and the edits and only exists while the
  // sheet is open, so closing one is enough to drop a half-finished edit —
  // there is no reset path to keep in sync with the open state.
  if (!open) return null;
  return <SettingsSheetBody onClose={onClose} />;
}

function SettingsSheetBody({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const titleId = useId();

  // This body only exists while the sheet is open — see the wrapper above — so
  // `open` is a constant here. The hook still takes it: it is what tells the
  // drag to clear anything it left on the node.
  const { sheetRef, dragStyle, handleProps } = useSheetDrag({
    open: true,
    onClose,
  });
  // Escape already worked here; it now comes from the helper all seven sheets
  // share, so the behaviour cannot drift between them.
  useEscapeToClose(onClose);

  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<SettingsResponse>("/api/settings", apiFetch);

  /**
   * Unsaved edits, layered over the last state the server confirmed. Holding
   * them apart from the fetched row is what lets a background revalidate (focus
   * or reconnect, both on by default in SWR) refresh the row underneath without
   * overwriting what the user is in the middle of typing.
   */
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const draft = useMemo(
    () => (data ? { ...toDraft(data), ...edits } : null),
    [data, edits]
  );

  /**
   * True when the quiet window would cover every slot that is actually switched
   * on: the state the user is about to save would silence all of their
   * reminders. Weekly rides the evening hour (slotHourFor in @/lib/reminders),
   * so it only adds a slot of its own when the evening kind is off.
   */
  const silencesEverything = useMemo(() => {
    if (!draft || !draft.enabled) return false;
    const quietWindow = {
      quiet_hours_start: draft.quietStart,
      quiet_hours_end: draft.quietEnd,
    };
    const kinds = {
      reminder_enabled: draft.enabled,
      reminder_kinds: {
        morning: draft.morning,
        nudge: draft.nudge,
        evening: draft.evening,
        weekly: draft.weekly,
      },
    };
    const slots: number[] = [];
    if (isKindEnabled(kinds, "morning")) slots.push(draft.morningHour);
    if (isKindEnabled(kinds, "nudge")) slots.push(draft.nudgeHour);
    if (isKindEnabled(kinds, "evening") || isKindEnabled(kinds, "weekly"))
      slots.push(draft.eveningHour);
    if (slots.length === 0) return false;
    return slots.every((hour) => isQuietHour(quietWindow, hour));
  }, [draft]);

  const update = (patch: Partial<Draft>) =>
    setEdits((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const updated = await apiFetch<SettingsResponse>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(toPatch(draft)),
      });
      haptics.success();
      // Drop the edits and seed the cache from the response: it is the row as
      // stored, so the form cannot drift by echoing back what was typed.
      setEdits({});
      await mutate(updated, { revalidate: false });
      toast(t("settingsSaved"), { kind: "success" });
      // Deliberately stays open. It used to close here purely so the success
      // toast would be visible — the toast was at z-index 60, under the sheet.
      // It now sits at the top of the screen at z-index 300, above an open
      // sheet, so the reason is gone; and a settings screen that disappears
      // mid-adjustment is worse than one that stays put.
    } catch (err) {
      haptics.error();
      // Reverting the optimistic change means dropping the edits: the fetched
      // row is still the pre-save state, so the form snaps back to it.
      setEdits({});
      const message = errorMessage(err, t);
      // Both: the inline line sits with the form the user is looking at, the
      // toast covers the case where the sheet closes underneath it.
      setSaveError(message);
      toast(message, { kind: "error" });
    } finally {
      setSaving(false);
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
        aria-labelledby={titleId}
      >
        <div className="sheet-handle" {...handleProps} />

        <div className="sheet-form">
          <h3 className="sheet-form-title" id={titleId}>
            {t("settings")}
          </h3>

          {loadError ? (
            <p className="sheet-error">{errorMessage(loadError, t)}</p>
          ) : null}

          {draft ? (
            <>
              <Toggle
                label={t("reminderEnabledLabel")}
                checked={draft.enabled}
                onChange={(next) => update({ enabled: next })}
              />

              <div className={styles.group}>
                <h4 className="section-label">{t("reminders")}</h4>

                <Toggle
                  label={t("morningPlan")}
                  hint={t("morningPlanHint")}
                  checked={draft.morning}
                  onChange={(next) => update({ morning: next })}
                />
                {draft.morning ? (
                  <label className={styles.timeRow}>
                    <span>{t("timeMorning")}</span>
                    <input
                      className={`sheet-input ${styles.timeInput}`}
                      type="time"
                      // Whole hours only: the column is a smallint hour, so a
                      // picker offering minutes would promise precision the
                      // scheduler cannot keep.
                      step={3600}
                      value={hourToTime(draft.morningHour)}
                      aria-label={t("timeMorning")}
                      onChange={(e) =>
                        update({
                          morningHour: timeToHour(
                            e.target.value,
                            draft.morningHour
                          ),
                        })
                      }
                    />
                  </label>
                ) : null}

                <Toggle
                  label={t("middayNudge")}
                  hint={t("middayNudgeHint")}
                  checked={draft.nudge}
                  onChange={(next) => update({ nudge: next })}
                />
                {draft.nudge ? (
                  <label className={styles.timeRow}>
                    <span>{t("timeNudge")}</span>
                    <input
                      className={`sheet-input ${styles.timeInput}`}
                      type="time"
                      step={3600}
                      value={hourToTime(draft.nudgeHour)}
                      aria-label={t("timeNudge")}
                      onChange={(e) =>
                        update({
                          nudgeHour: timeToHour(
                            e.target.value,
                            draft.nudgeHour
                          ),
                        })
                      }
                    />
                  </label>
                ) : null}

                <Toggle
                  label={t("eveningReview")}
                  hint={t("eveningReviewHint")}
                  checked={draft.evening}
                  onChange={(next) => update({ evening: next })}
                />
                {draft.evening ? (
                  <label className={styles.timeRow}>
                    <span>{t("timeEvening")}</span>
                    <input
                      className={`sheet-input ${styles.timeInput}`}
                      type="time"
                      step={3600}
                      value={hourToTime(draft.eveningHour)}
                      aria-label={t("timeEvening")}
                      onChange={(e) =>
                        update({
                          eveningHour: timeToHour(
                            e.target.value,
                            draft.eveningHour
                          ),
                        })
                      }
                    />
                  </label>
                ) : null}

                {/* No picker of its own: the weekly report rides the evening
                    slot (slotHourFor), so the evening time already sets it. */}
                <Toggle
                  label={t("weeklyReportLabel")}
                  hint={t("weeklyReportHint")}
                  checked={draft.weekly}
                  onChange={(next) => update({ weekly: next })}
                />
              </div>

              <div className={styles.group}>
                <h4 className="section-label">{t("quietHoursLabel")}</h4>
                <p className={styles.hint}>{t("quietHoursHint")}</p>
                <div className={styles.quietGrid}>
                  <label className={styles.quietField}>
                    <span>{t("quietFrom")}</span>
                    <select
                      className={`sheet-input ${styles.select}`}
                      value={draft.quietStart}
                      aria-label={t("quietFrom")}
                      onChange={(e) =>
                        update({ quietStart: Number(e.target.value) })
                      }
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {hourToTime(hour)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.quietField}>
                    <span>{t("quietTo")}</span>
                    <select
                      className={`sheet-input ${styles.select}`}
                      value={draft.quietEnd}
                      aria-label={t("quietTo")}
                      onChange={(e) =>
                        update({ quietEnd: Number(e.target.value) })
                      }
                    >
                      {HOURS.map((hour) => (
                        <option key={hour} value={hour}>
                          {hourToTime(hour)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {silencesEverything ? (
                  <p className={styles.warning} role="status">
                    {hourToTime(draft.quietStart)}–{hourToTime(draft.quietEnd)}{" "}
                    · {t("quietHoursWarning")}
                  </p>
                ) : null}
              </div>

              <label className={styles.fieldRow}>
                <span className={styles.rowLabel}>{t("maxPerDayLabel")}</span>
                <select
                  className={`sheet-input ${styles.numberSelect}`}
                  value={draft.maxPerDay}
                  aria-label={t("maxPerDayLabel")}
                  onChange={(e) => update({ maxPerDay: Number(e.target.value) })}
                >
                  {MAX_PER_DAY_CHOICES.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>

              {/* Read-only: apiFetch sends the device timezone on every request
                  and withAuth stores it, so there is nothing here to edit.
                  Pairing it with the local time is what makes a wrong timezone
                  obvious. */}
              <div className={styles.timezone}>
                <span className="section-label">{t("timezoneLabel")}</span>
                <div className={styles.timezoneRow}>
                  <span className={styles.timezoneValue}>{draft.timezone}</span>
                  <span className={styles.localTime}>{draft.localTime}</span>
                </div>
                <p className={styles.hint}>{t("timezoneHint")}</p>
              </div>

              {saveError ? <p className="sheet-error">{saveError}</p> : null}

              <div className="sheet-actions">
                <button
                  type="button"
                  className="sheet-cancel-btn"
                  onClick={onClose}
                  style={{ minHeight: 44 }}
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  className="sheet-submit-btn"
                  onClick={handleSave}
                  disabled={saving}
                  style={{ minHeight: 44 }}
                >
                  {saving ? t("saving") : t("save")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
