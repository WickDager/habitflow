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
}

const TelegramContext = createContext<TelegramContextValue>({
  user: null,
  initData: "",
  isReady: false,
});

const TG = typeof window !== "undefined" ? window.Telegram : null;

function applyTheme() {
  const theme = TG?.WebApp?.themeParams;
  if (!theme) return;
  const raw = theme as Record<string, string>;
  Object.entries(raw).forEach(([k, v]) => {
    const cssVar = "--tg-theme-" + k.replace(/_/g, "-");
    document.documentElement.style.setProperty(cssVar, v);
  });
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [value] = useState<TelegramContextValue>(() => {
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
      return { user, initData, isReady: true };
    }
    // Dev mock
    return {
      user: { id: 12345, first_name: "Dev", username: "devuser" },
      initData: "mock_init_data",
      isReady: true,
    };
  });

  useEffect(() => {
    if (TG?.WebApp) {
      TG.WebApp.expand();
      applyTheme();
      TG.WebApp.onEvent("themeChanged", applyTheme);
      TG.WebApp.ready();
    }
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
