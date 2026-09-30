import { ApiError } from "./apiFetch";

export type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string;

/**
 * One place that turns a thrown error into something a person can read.
 *
 * Previously every catch block in the app did `setError(t("saveFailed"))`, so
 * a rate limit, an expired session and a genuine server fault were
 * indistinguishable — and on Telegram Web, where haptics and showAlert are
 * no-ops, some of them produced no feedback at all.
 */
export function errorMessage(err: unknown, t: Translate): string {
  if (err instanceof ApiError) {
    if (err.reopen) return t("sessionExpired");
    if (err.status === 401) return t("authFailed");
    if (err.status === 429) return t("rateLimited");
    if (err.status >= 500) return t("serverError");
    return t("saveFailed");
  }
  if (err instanceof Error && err.message === "NOT_IN_TELEGRAM") {
    return t("notInTelegram");
  }
  return t("saveFailed");
}
