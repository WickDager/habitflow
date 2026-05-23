import { createHmac, timingSafeEqual } from "crypto";

export interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
  language_code?: string;
}

export function validateInitData(
  initData: string,
  botToken: string
): { isValid: boolean; user: TelegramUser | null } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { isValid: false, user: null };
    params.delete("hash");

    const sorted = [...params.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const checkString = sorted.map(([k, v]) => `${k}=${v}`).join("\n");

    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computed = createHmac("sha256", secret)
      .update(checkString)
      .digest("hex");

    if (!timingSafeEqual(Buffer.from(computed), Buffer.from(hash))) {
      console.error("validateInitData HMAC mismatch:", {
        computedLen: computed.length,
        hashLen: hash.length,
        checkStringPreview: checkString.slice(0, 200),
        hashPreview: hash.slice(0, 16),
        computedPreview: computed.slice(0, 16),
        keys: sorted.map(([k]) => k),
        totalKeys: sorted.length,
      });
      return { isValid: false, user: null };
    }

    const authDate = Number(params.get("auth_date"));
    if (Date.now() / 1000 - authDate > 300) {
      console.error("validateInitData auth_date expired:", {
        authDate,
        now: Math.floor(Date.now() / 1000),
        diff: Date.now() / 1000 - authDate,
      });
      return { isValid: false, user: null };
    }

    return { isValid: true, user: JSON.parse(params.get("user")!) };
  } catch {
    return { isValid: false, user: null };
  }
}
