"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { en } from "./en";
import { ru } from "./ru";

export type Lang = "en" | "ru";

const STORAGE_KEY = "habitflow_lang";

const translations: Record<Lang, Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  ru: ru as unknown as Record<string, string>,
};

interface LanguageContextValue {
  lang: Lang;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  t: (key: string) => key,
  setLang: () => {},
});

function detectInitialLanguage(): Lang {
  if (typeof window === "undefined") return "en";

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "ru") return stored;

  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang === "ru" || tgLang === "uk" || tgLang === "be") return "ru";

  return "en";
}

function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => String(params[key] ?? `{{${key}}}`)
  );
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLanguage);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const template = translations[lang][key];
      if (!template) return key;
      return interpolate(template, params);
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, t, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
