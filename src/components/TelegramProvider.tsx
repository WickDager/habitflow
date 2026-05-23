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

function applyTheme() {
  let theme: Record<string, string> | undefined;

  const tgTheme = window.Telegram?.WebApp?.themeParams;
  if (tgTheme) {
    theme = tgTheme as Record<string, string>;
  } else {
    // Telegram Web: theme params in URL fragment
    const raw = parseHashParam(window.location.hash, "tgWebAppThemeParams");
    if (raw) {
      try {
        theme = JSON.parse(decodeURIComponent(raw));
      } catch { /* ignore */ }
    }
  }

  if (!theme) return;
  Object.entries(theme).forEach(([k, v]) => {
    const cssVar = "--tg-theme-" + k.replace(/_/g, "-");
    document.documentElement.style.setProperty(cssVar, v);
  });
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
    applyTheme();

    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    wa.expand();
    const handler = () => applyTheme();
    wa.onEvent("themeChanged", handler);
    wa.ready();
    return () => {
      wa.offEvent("themeChanged", handler);
    };
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
