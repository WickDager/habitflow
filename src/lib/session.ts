import jwt from "jsonwebtoken";

/**
 * Long-lived session tokens.
 *
 * Telegram Web carries init data in the URL fragment, generated once when the
 * Mini App opens, and that fragment never refreshes. So init data goes stale
 * after Telegram's auth_date window and the user would have to reopen the app
 * from the bot to keep using it.
 *
 * A session token is minted only after init data has passed the HMAC check, is
 * bound to one user, and lives for 30 days. The client stores it and sends it
 * alongside init data; the API prefers fresh init data and falls back to the
 * session token when init data is missing or merely old. That turns "reopen
 * from the bot every day" into "reopen every 30 days".
 *
 * This is not a weaker check than init data: forging either one requires the
 * bot token (init data) or SUPABASE_JWT_SECRET (session).
 */

const SESSION_TTL_DAYS = 30;

export const SESSION_HEADER = "x-session-token";

export interface SessionPayload {
  /** Internal users.id (uuid). */
  userId: string;
  /** Telegram user id. */
  telegramId: number;
}

function secret(): string | null {
  return process.env.SUPABASE_JWT_SECRET || null;
}

export function mintSession(userId: string, telegramId: number): string | null {
  const key = secret();
  if (!key) return null;
  try {
    return jwt.sign(
      { sub: userId, tg: telegramId, kind: "session" },
      key,
      { expiresIn: `${SESSION_TTL_DAYS}d` }
    );
  } catch {
    return null;
  }
}

export function verifySession(token: string): SessionPayload | null {
  const key = secret();
  if (!key) return null;
  try {
    const decoded = jwt.verify(token, key) as {
      sub?: unknown;
      tg?: unknown;
      kind?: unknown;
    };
    if (
      decoded.kind !== "session" ||
      typeof decoded.sub !== "string" ||
      typeof decoded.tg !== "number"
    )
      return null;
    return { userId: decoded.sub, telegramId: decoded.tg };
  } catch {
    return null;
  }
}
