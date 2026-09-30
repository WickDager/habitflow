"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { errorMessage, type Translate } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { useToast } from "@/components/Toast";
import { useLanguage } from "@/lib/i18n";
import styles from "./ShareSheet.module.css";

/**
 * Accountability partners.
 *
 * One habit, two people, one shared streak. A shared habit has a single
 * check-in row per day, so a day counts if *either* of you completed it and the
 * streak only breaks when you both miss — that is `together_days`.
 *
 * `my_days` and `partner_days` are how many days each of you personally did it,
 * which is the honest per-person number: there is no separate per-person streak
 * to report, because both people advance the same row.
 *
 * Self-contained: mounts as <ShareSheet open={...} onClose={...} /> and manages
 * its own data. Pass `habitId` to pin it to one habit; without it the sheet
 * offers a picker of the habits this user can invite on (the ones they own).
 */

interface Share {
  habit_id: string;
  owner_id: string;
  member_id: string;
  status: string;
  created_at: string;
  role: "owner" | "member";
  habit: { id: string; name: string; icon: string | null } | null;
  partner: { id: string; first_name: string; username: string | null } | null;
  my_days: number;
  partner_days: number;
  together_days: number;
  together_total: number;
}

interface Habit {
  id: string;
  name: string;
  icon: string;
}

interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional: pin the sheet to a single habit. */
  habitId?: string | null;
}

/**
 * The API answers with an i18n *key* rather than a sentence, so both partners
 * read the failure in their own language.
 */
function inviteError(err: unknown, t: Translate): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "partnerNeedsStart") return t("partnerNeedsStart");
  if (code === "partnerCantInviteSelf") return t("partnerCantInviteSelf");
  return errorMessage(err, t);
}

export function ShareSheet({ open, onClose, habitId = null }: ShareSheetProps) {
  const { t } = useLanguage();
  const { toast } = useToast();

  const [selected, setSelected] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: shares, mutate: mutateShares } = useSWR<Share[]>(
    open ? "/api/shares" : null,
    apiFetch
  );
  const { data: habits } = useSWR<Habit[]>(open ? "/api/habits" : null, apiFetch);

  useEffect(() => {
    if (open) haptics.select();
  }, [open]);

  /**
   * Reset while rendering rather than in an effect — React's recommended way to
   * clear state when a prop flips. Each open starts blank: no leftover Telegram
   * id and no stale error from the last attempt.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTelegramId("");
      setError("");
    }
  }

  if (!open) return null;

  const habitOptions = habits ?? [];
  const list = shares ?? [];

  // Prefer the pinned habit, then whatever was picked, then the first one.
  const activeHabitId = habitId ?? selected ?? habitOptions[0]?.id ?? null;
  const activeHabit = habitOptions.find((h) => h.id === activeHabitId) ?? null;

  const forHabit = list.filter((share) => share.habit_id === activeHabitId);
  const incoming = list.filter(
    (share) => share.role === "member" && share.status === "pending"
  );
  const accepted = forHabit.filter((share) => share.status === "accepted");
  const outgoing = forHabit.filter(
    (share) => share.role === "owner" && share.status === "pending"
  );

  const partnerName = (share: Share) =>
    share.partner?.first_name ?? t("partnerNone");

  /**
   * habit_shares has no id column and one habit can have several partners, so
   * the habit alone is not a unique key.
   */
  const shareKey = (share: Share) =>
    `${share.habit_id}:${share.partner?.id ?? share.member_id}`;

  const invite = async () => {
    const id = Number(telegramId);
    if (!activeHabitId || !Number.isFinite(id) || id <= 0) return;

    setBusy(true);
    setError("");
    try {
      const share = await apiFetch<{ status: string }>("/api/shares", {
        method: "POST",
        body: JSON.stringify({ habit_id: activeHabitId, telegram_id: id }),
      });
      haptics.success();
      setTelegramId("");
      await mutateShares();
      // Inviting someone who is already your partner changes nothing, so saying
      // "invite sent" would describe something that did not happen.
      toast(share?.status === "accepted" ? t("saved") : t("partnerPending"), {
        kind: "success",
      });
    } catch (err) {
      haptics.error();
      setError(inviteError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (share: Share, action: "accept" | "decline") => {
    setBusy(true);
    try {
      await apiFetch("/api/shares", {
        method: "PATCH",
        body: JSON.stringify({ habit_id: share.habit_id, action }),
      });
      haptics.success();
      await mutateShares();
      toast(t("saved"), { kind: "success" });
    } catch (err) {
      haptics.error();
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (share: Share) => {
    const params = new URLSearchParams({ habit_id: share.habit_id });
    // As the owner we name the partner we are removing; as the member we only
    // remove ourselves, so the API can tell the two gestures apart.
    if (share.role === "owner") params.set("member_id", share.member_id);

    setBusy(true);
    try {
      await apiFetch(`/api/shares?${params.toString()}`, { method: "DELETE" });
      haptics.success();
      await mutateShares();
      toast(t("deleted"), { kind: "success" });
    } catch (err) {
      haptics.error();
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.overlay} onClick={onClose} aria-hidden="true" />
      <div className={styles.sheet} role="dialog" aria-modal="true">
        <div className={styles.handle} />

        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>{t("accountabilityPartner")}</h3>
            <p className={styles.hint}>{t("partnerHint")}</p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("cancel")}
          >
            ✕
          </button>
        </div>

        {/* Invites waiting on this user, whatever habit they belong to. */}
        {incoming.length > 0 && (
          <div className={styles.section}>
            {incoming.map((share) => (
              <div key={shareKey(share)} className={styles.row}>
                <span className={styles.rowIcon}>
                  {share.habit?.icon ?? "🤝"}
                </span>
                <span className={styles.rowBody}>
                  <span className={styles.rowName}>
                    {share.habit?.name ?? t("habitsSection")}
                  </span>
                  <span className={styles.rowMeta}>{partnerName(share)}</span>
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => respond(share, "decline")}
                    disabled={busy}
                  >
                    {t("partnerDecline")}
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => respond(share, "accept")}
                    disabled={busy}
                  >
                    {t("partnerAccept")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {habitOptions.length === 0 ? (
          <p className={styles.placeholder}>{t("noHabitsYet")}</p>
        ) : (
          <>
            {/* Only shown when the caller did not pin a habit. */}
            {!habitId && (
              <div className={styles.section}>
                <div className={styles.habitPicker}>
                  {habitOptions.map((habit) => (
                    <button
                      key={habit.id}
                      type="button"
                      className={`${styles.habitChip} ${
                        habit.id === activeHabitId ? styles.selected : ""
                      }`}
                      onClick={() => {
                        haptics.select();
                        setSelected(habit.id);
                      }}
                      aria-pressed={habit.id === activeHabitId}
                    >
                      <span>{habit.icon}</span>
                      <span>{habit.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.section}>
              {accepted.length === 0 && outgoing.length === 0 ? (
                <p className={styles.placeholder}>{t("partnerNone")}</p>
              ) : (
                <>
                  {accepted.map((share) => (
                    <div key={shareKey(share)} className={styles.row}>
                      <span className={styles.rowIcon}>
                        {share.habit?.icon ?? "🤝"}
                      </span>
                      <span className={styles.rowBody}>
                        <span className={styles.rowName}>
                          {partnerName(share)}
                        </span>
                        <span className={`${styles.rowMeta} ${styles.together}`}>
                          {t("partnerTogether", {
                            count: share.together_days,
                          })}
                        </span>
                      </span>
                      <span className={styles.rowActions}>
                        <button
                          type="button"
                          className={`${styles.ghostBtn} ${styles.dangerBtn}`}
                          onClick={() => revoke(share)}
                          disabled={busy}
                        >
                          {t("delete")}
                        </button>
                      </span>
                    </div>
                  ))}

                  {outgoing.map((share) => (
                    <div key={shareKey(share)} className={styles.row}>
                      <span className={styles.rowIcon}>
                        {share.habit?.icon ?? "🤝"}
                      </span>
                      <span className={styles.rowBody}>
                        <span className={styles.rowName}>
                          {partnerName(share)}
                        </span>
                        <span className={styles.rowMeta}>
                          {t("partnerPending")}
                        </span>
                      </span>
                      <span className={styles.rowActions}>
                        <button
                          type="button"
                          className={`${styles.ghostBtn} ${styles.dangerBtn}`}
                          onClick={() => revoke(share)}
                          disabled={busy}
                        >
                          {t("delete")}
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className={styles.section}>
              <p className={styles.sectionTitle}>
                {activeHabit?.name ?? t("accountabilityPartner")}
              </p>
              <div className={styles.inviteRow}>
                <input
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={telegramId}
                  onChange={(event) =>
                    setTelegramId(event.target.value.replace(/\D/g, ""))
                  }
                  aria-label={t("partnerInvite")}
                />
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={invite}
                  disabled={busy || !telegramId || !activeHabitId}
                >
                  {t("partnerInvite")}
                </button>
              </div>
              {error && <p className={styles.error}>{error}</p>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
