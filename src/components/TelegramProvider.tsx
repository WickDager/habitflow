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
  const theme = window.Telegram?.WebApp?.themeParams;
  if (!theme) return;
  const raw = theme as Record<string, string>;
  Object.entries(raw).forEach(([k, v]) => {
    const cssVar = "--tg-theme-" + k.replace(/_/g, "-");
    document.documentElement.style.setProperty(cssVar, v);
  });
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [value] = useState<TelegramContextValue>(getTelegramValue);

  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    wa.expand();
    applyTheme();
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
