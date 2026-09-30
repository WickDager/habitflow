"use client";

import useSWR from "swr";
import { apiFetch, ApiError } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "./Toast";
import styles from "./StreakProtection.module.css";

/**
 * Streak at risk, with the monthly grace day.
 *
 * `POST /api/streak` existed with no caller, so the grace day was unreachable
 * from the app — a feature nobody could use. This surfaces it in the one place
 * it matters: a live streak with nothing logged today.
 */

interface StreakHabit {
  habit_id: string;
  name: string;
  icon: string;
  current_streak: number;
  total_completions: number;
  last_completed: string | null;
  atRisk: boolean;
}

interface StreakResponse {
  habits: StreakHabit[];
  grace_day_available: boolean;
  freeze_month: string | null;
}

export function StreakProtection() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { data, mutate } = useSWR<StreakResponse>("/api/streak", apiFetch);

  const atRisk = (data?.habits ?? []).filter((h) => h.atRisk);
  // Nothing to protect, or nothing left to protect it with.
  if (atRisk.length === 0) return null;

  const canFreeze = data?.grace_day_available ?? false;

  // Not a hook — named "apply" so it isn't mistaken for one.
  const applyGraceDay = async (habit: StreakHabit) => {
    try {
      const result = await apiFetch<{ frozen: boolean; reason?: string }>(
        "/api/streak",
        {
          method: "POST",
          body: JSON.stringify({ action: "freeze", habit_id: habit.habit_id }),
        }
      );
      // A 200 with frozen:false means there was nothing to repair and the
      // month's grace day was NOT spent — saying "protection used" here would
      // be a lie.
      toast(result.frozen ? t("graceDayUsed") : t("graceDayNotNeeded"), {
        kind: result.frozen ? "success" : "info",
      });
      await mutate();
    } catch (err) {
      const message =
        err instanceof ApiError && err.message === "graceDayNone"
          ? t("graceDayNone")
          : errorMessage(err, t);
      toast(message, { kind: "error" });
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>🔥 {t("streakAtRiskTitle")}</h2>
      <ul className={styles.list}>
        {atRisk.map((habit) => (
          <li key={habit.habit_id} className={styles.row}>
            <span className={styles.habit}>
              {habit.icon} {habit.name}
              <span className={styles.count}>{habit.current_streak}</span>
            </span>
            <button
              type="button"
              className={styles.action}
              disabled={!canFreeze}
              title={canFreeze ? t("graceDayHint") : t("graceDayNone")}
              onClick={() => applyGraceDay(habit)}
            >
              {canFreeze ? t("graceDay") : t("graceDayNone")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
