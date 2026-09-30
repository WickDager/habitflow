export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Server says the init data is too old — the user must reopen from the bot. */
    public reopen = false
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const SESSION_STORAGE_KEY = "habitflow_session";

function readSessionToken(): string | undefined {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSessionToken(token: string | null) {
  if (!token) return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    /* private mode / storage disabled — session just won't persist */
  }
}

/** Device timezone, sent so the server can schedule reminders in local time. */
function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function getInitData(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const tgInitData = window.Telegram?.WebApp?.initData;
  if (tgInitData) return tgInitData;

  // Telegram Web (browser version): init data in URL fragment
  const hash = window.location.hash;
  if (hash.includes("tgWebAppData=")) {
    const prefix = "tgWebAppData=";
    const start = hash.indexOf(prefix) + prefix.length;
    const end = hash.indexOf("&", start);
    const raw = end === -1 ? hash.slice(start) : hash.slice(start, end);
    if (raw) return decodeURIComponent(raw);
  }

  if (process.env.NODE_ENV === "development") {
    return process.env.NEXT_PUBLIC_MOCK_INIT_DATA;
  }

  return undefined;
}

export async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const initData = getInitData();
  const sessionToken = readSessionToken();

  // A session token alone is enough: the server trades it for a fresh
  // Supabase JWT. This is what keeps the app alive past Telegram's
  // auth_date window on Telegram Web, where init data never refreshes.
  if (!initData && !sessionToken) {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "development") {
      throw new Error("NOT_IN_TELEGRAM");
    }
    throw new Error(
      `Telegram init data is missing. Open the app via https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}/${process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME}`
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (initData) headers["x-telegram-init-data"] = initData;
  if (sessionToken) headers["x-session-token"] = sessionToken;
  const tz = deviceTimezone();
  if (tz) headers["x-timezone"] = tz;

  const res = await fetch(url, { ...options, headers });

  // The API refreshes the session token on every init-data request, sliding
  // the 30-day window forward.
  const refreshed = res.headers.get("x-session-token");
  if (refreshed) writeSessionToken(refreshed);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "API_ERROR", !!body.reopen);
  }

  if (res.status === 204) return undefined as T;

  return res.json();
}
