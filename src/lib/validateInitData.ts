import { createHmac, timingSafeEqual } from "crypto";

export interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
  language_code?: string;
}

/**
 * How long received init data stays valid, in seconds.
 *
 * Telegram's own reference implementation (@telegram-apps/init-data-node,
 * v2.0.10) defaults this to 86400 — 24 hours. This file previously used
 * 300, which is what broke the app on Telegram Web.
 *
 * Telegram Web does not inject window.Telegram.WebApp; it passes init data
 * in the URL fragment, generated once when the Mini App is opened. That
 * fragment never refreshes, so the same auth_date is reused for the whole
 * lifetime of the page. After 5 minutes every API call carried stale data
 * and 401'd — on a reload, from the very first request.
 *
 * The HMAC below is what actually proves authenticity: it cannot be forged
 * without the bot token. auth_date only limits replay, and Telegram's docs
 * treat checking it as optional ("you can additionally check the auth_date
 * field"), specifying no window. Set to 0 to disable the check entirely.
 */
const INIT_DATA_MAX_AGE_SECONDS = Number(
  process.env.INIT_DATA_MAX_AGE_SECONDS ?? 86400
);

export type ValidationFailure =
  | "NO_HASH"
  | "HMAC_MISMATCH"
  | "EXPIRED"
  | "NO_USER"
  | "THREW";

export interface ValidationResult {
  isValid: boolean;
  user: TelegramUser | null;
  /** Why validation failed. Undefined when isValid is true. */
  reason?: ValidationFailure;
}

export function validateInitData(
  initData: string,
  botToken: string
): ValidationResult {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { isValid: false, user: null, reason: "NO_HASH" };

    // Only "hash" is removed. "signature" (Ed25519, present in Telegram Web
    // init data and absent on mobile) MUST stay in the check string — it is
    // part of the data Telegram hashed. Deleting it was tried before and is
    // wrong; @telegram-apps/init-data-node deletes only "hash" too.
    params.delete("hash");

    // Sort the joined "key=value" strings, the way the reference does.
    // Sorting keys and then joining is not equivalent in general, and
    // localeCompare is locale-dependent — the order must match by code unit.
    const checkString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("\n");

    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computed = createHmac("sha256", secret).update(checkString).digest();

    // Compare digest bytes, not hex text. Buffer.from(hexString) with no
    // encoding yields a UTF-8 buffer of the hex characters, and
    // timingSafeEqual THROWS when the two buffers differ in length — which
    // the outer catch would silently turn into a generic failure.
    const received = Buffer.from(hash, "hex");
    const matches =
      received.length === computed.length && timingSafeEqual(computed, received);

    if (!matches) {
      console.error("validateInitData HMAC mismatch:", {
        checkStringPreview: checkString.slice(0, 200),
        keys: [...params.keys()],
        hashPreview: hash.slice(0, 16),
        computedPreview: computed.toString("hex").slice(0, 16),
      });
      return { isValid: false, user: null, reason: "HMAC_MISMATCH" };
    }

    const authDate = Number(params.get("auth_date"));
    const ageSeconds = Date.now() / 1000 - authDate;
    if (INIT_DATA_MAX_AGE_SECONDS > 0 && ageSeconds > INIT_DATA_MAX_AGE_SECONDS) {
      console.error("validateInitData auth_date expired:", {
        authDate,
        ageSeconds: Math.floor(ageSeconds),
        maxAgeSeconds: INIT_DATA_MAX_AGE_SECONDS,
      });
      return { isValid: false, user: null, reason: "EXPIRED" };
    }

    const rawUser = params.get("user");
    if (!rawUser) return { isValid: false, user: null, reason: "NO_USER" };

    return { isValid: true, user: JSON.parse(rawUser) as TelegramUser };
  } catch (err) {
    console.error("validateInitData threw:", err);
    return { isValid: false, user: null, reason: "THREW" };
  }
}
