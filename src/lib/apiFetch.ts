export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getInitData(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const tgInitData = window.Telegram?.WebApp?.initData;
  if (tgInitData) return tgInitData;

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

  if (!initData) {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "development") {
      throw new Error("NOT_IN_TELEGRAM");
    }
    throw new Error(
      `Telegram init data is missing. Open the app via https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}/${process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME}`
    );
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": initData,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "API_ERROR");
  }

  return res.json();
}
