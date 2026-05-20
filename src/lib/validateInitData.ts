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
): TelegramUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("INVALID_INIT_DATA");
  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");

  if (
    !timingSafeEqual(Buffer.from(computed), Buffer.from(hash))
  )
    throw new Error("INVALID_INIT_DATA");

  const authDate = Number(params.get("auth_date"));
  if (Date.now() / 1000 - authDate > 300)
    throw new Error("INIT_DATA_EXPIRED");

  return JSON.parse(params.get("user")!);
}
