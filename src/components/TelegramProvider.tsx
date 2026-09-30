"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface TelegramContextValue {
  user: { id: number; first_name: string; username?: string } | null;
  initData: string;
  isReady: boolean;
  checked: boolean;
}

const TelegramContext = createContext<TelegramContextValue>({
  user: null,
  initData: "",
  isReady: false,
  checked: false,
});

function parseHashParam(hash: string, key: string): string | undefined {
  const prefix = key + "=";
  const start = hash.indexOf(prefix);
  if (start === -1) return undefined;
  const valStart = start + prefix.length;
  const end = hash.indexOf("&", valStart);
  return end === -1 ? hash.slice(valStart) : hash.slice(valStart, end);
}

function getTelegramValue(): TelegramContextValue {
  if (typeof window === "undefined") {
    return { user: null, initData: "", isReady: false, checked: false };
  }

  const TG = window.Telegram;
  if (TG?.WebApp) {
    const initData = TG.WebApp.initData;
    let user: TelegramContextValue["user"] = null;
    const raw = TG.WebApp.initDataUnsafe?.user;
    if (raw) {
      user = {
        id: raw.id,
        first_name: raw.first_name,
        username: raw.username,
      };
    }
    return { user, initData, isReady: true, checked: true };
  }

  // Telegram Web (browser version): init data passed via URL fragment
  const hash = window.location.hash;
  if (hash.includes("tgWebAppData=")) {
    const rawData = parseHashParam(hash, "tgWebAppData");
    if (rawData) {
      const initData = decodeURIComponent(rawData);
      let user: TelegramContextValue["user"] = null;

      const userMatch = initData.match(/user=({.*?})(?:&|$)/);
      if (userMatch) {
        try {
          const parsed = JSON.parse(decodeURIComponent(userMatch[1]));
          user = {
            id: parsed.id,
            first_name: parsed.first_name || "",
            username: parsed.username,
          };
        } catch { /* ignore parse errors */ }
      }

      return { user, initData, isReady: true, checked: true };
    }
  }

  if (process.env.NODE_ENV === "development") {
    const mockInitData = process.env.NEXT_PUBLIC_MOCK_INIT_DATA;
    return {
      user: { id: 12345, first_name: "Dev", username: "devuser" },
      initData: mockInitData || "mock_init_data",
      isReady: true,
      checked: true,
    };
  }

  return { user: null, initData: "", isReady: false, checked: true };
}

/**
 * The app is dark-only, so Telegram's own theme is deliberately ignored.
 *
 * This used to copy Telegram's `themeParams` (or the `tgWebAppThemeParams`
 * fragment on Web) onto <html> as `--tg-theme-*` *inline* styles. Inline custom
 * properties outrank any stylesheet rule, which is exactly why the old
 * light/dark toggle appeared to do nothing: the class flipped and the inline
 * values kept winning. With them gone, the palette in globals.css is the single
 * source of truth.
 *
 * The chrome is still matched to the app, so the WebView's header and the area
 * behind the content don't flash a light colour against a dark page. Both calls
 * are optional-chained: they are newer Bot API methods and Telegram Web has no
 * `window.Telegram` at all.
 */
const DARK_CHROME = "#1c1c1e";

function applyChrome() {
  const wa = window.Telegram?.WebApp;
  if (!wa) return;
  try {
    wa.setHeaderColor?.(DARK_CHROME);
    wa.setBackgroundColor?.(DARK_CHROME);
  } catch {
    /* older clients: the palette still applies, only the chrome stays default */
  }
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<TelegramContextValue>({
    user: null,
    initData: "",
    isReady: false,
    checked: false,
  });

  useEffect(() => {
    // window.Telegram is a browser-only API — must initialize in an effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(getTelegramValue());
  }, []);

  useEffect(() => {
    applyChrome();

    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    wa.expand();
    wa.ready();
    // No themeChanged listener: there is no theme to follow any more.
  }, []);

  return (
    <TelegramContext.Provider value={value}>
      {children}
    </TelegramContext.Provider>
  );
}

export function useTelegram() {
  return useContext(TelegramContext);
}
