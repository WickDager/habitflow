"use client";

import { useState, useEffect, useCallback } from "react";
import { TodayView } from "@/components/TodayView";
import { TasksView } from "@/components/TasksView";
import { StatsView } from "@/components/StatsView";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { FAB } from "@/components/FAB";
import { CreateModal } from "@/components/CreateModal";
import { useTelegram } from "@/components/TelegramProvider";
import { useLanguage } from "@/lib/i18n";

type Tab = "today" | "tasks" | "stats";

function getTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("habitflow-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("today");
  const [modalOpen, setModalOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => getTheme());

  const { t } = useLanguage();
  const { isReady, checked } = useTelegram();

  const isDev = process.env.NODE_ENV === "development";

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("habitflow-theme", next);
      return next;
    });
  }, []);

  if (!checked) {
    return null;
  }

  if (!isReady && !isDev) {
    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "your_bot";
    const tg = typeof window !== "undefined" ? window.Telegram : undefined;
    const hasTg = !!tg;
    const hasWebApp = !!tg?.WebApp;
    return (
      <div className="error-state" style={{ paddingTop: "10vh", padding: "20px" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 12 }}>{t("appTitle")}</h1>
        <p>{t("notInTelegram")}</p>
        <p style={{ marginTop: 8, opacity: 0.7 }}>
          {t("notInTelegramDesc", { bot: botUsername })}
        </p>
        <div style={{ marginTop: 20, padding: 12, background: "rgba(255,255,255,0.05)", borderRadius: 8, fontSize: "0.8rem", lineHeight: 1.6, fontFamily: "monospace" }}>
          <p><strong>Debug:</strong></p>
          <p>window.Telegram: {String(hasTg)}</p>
          <p>window.Telegram.WebApp: {String(hasWebApp)}</p>
          <p>href: {typeof window !== "undefined" ? window.location.href : "N/A"}</p>
          <p>ua: {typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 70) : "N/A"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <nav className="top-nav">
        <div className="nav-header">
          <span className="nav-header-left">HabitFlow</span>
          <div className="nav-header-right">
            <LanguageSwitcher />
            <button
              className="nav-icon-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              style={{ minHeight: 36, minWidth: 36 }}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

        <div className="tab-bar">
          <button
            className={`tab-btn${tab === "today" ? " active" : ""}`}
            onClick={() => setTab("today")}
            aria-label={t("ariaToday")}
            style={{ minHeight: 40 }}
          >
            {t("tabToday")}
          </button>
          <button
            className={`tab-btn${tab === "tasks" ? " active" : ""}`}
            onClick={() => setTab("tasks")}
            aria-label={t("ariaTasks")}
            style={{ minHeight: 40 }}
          >
            {t("tabTasks")}
          </button>
          <button
            className={`tab-btn${tab === "stats" ? " active" : ""}`}
            onClick={() => setTab("stats")}
            aria-label={t("ariaStats")}
            style={{ minHeight: 40 }}
          >
            {t("tabStats")}
          </button>
        </div>
      </nav>

      {tab === "today" ? (
        <TodayView />
      ) : tab === "tasks" ? (
        <TasksView />
      ) : (
        <StatsView />
      )}

      <FAB onClick={() => setModalOpen(true)} label={t("newHabit")} />
      <CreateModal key={modalOpen ? "1" : "0"} open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
