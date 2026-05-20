"use client";

import { useLanguage } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  return (
    <div className="lang-switcher">
      <button
        className={`lang-btn ${lang === "en" ? "active" : ""}`}
        onClick={() => setLang("en")}
        aria-label="Switch to English"
        style={{ minHeight: 44, minWidth: 44 }}
      >
        EN
      </button>
      <button
        className={`lang-btn ${lang === "ru" ? "active" : ""}`}
        onClick={() => setLang("ru")}
        aria-label="Переключить на русский"
        style={{ minHeight: 44, minWidth: 44 }}
      >
        RU
      </button>
    </div>
  );
}
