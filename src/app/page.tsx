"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TodayView } from "@/components/TodayView";
import { TasksView } from "@/components/TasksView";
import { StatsView } from "@/components/StatsView";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { FAB } from "@/components/FAB";
import { CreateModal } from "@/components/CreateModal";
import { SettingsSheet } from "@/components/SettingsSheet";
import { RoutinesSheet } from "@/components/RoutinesSheet";
import { ShareSheet } from "@/components/ShareSheet";
import styles from "./page.module.css";
import { useTelegram } from "@/components/TelegramProvider";
import { useLanguage } from "@/lib/i18n";

type Tab = "today" | "tasks" | "stats";

type Sheet = "create" | "settings" | "routines" | "share" | null;

/**
 * Browser-only: reads the stored theme. Must not be called during render —
 * the server always renders the "dark" default, so a stored "light" would make
 * the client's first render disagree with the server's markup.
 */
function getStoredTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem("habitflow-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return "dark";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("today");
  /**
   * One slot rather than four independent booleans. Four flags allowed (in
   * principle) several sheets open at once, stacked by DOM order with identical
   * z-indexes — unreachable today only because an open sheet's overlay happens
   * to cover the other triggers. This makes it impossible by construction.
   */
  const [sheet, setSheet] = useState<Sheet>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ today: null, tasks: null, stats: null });

  const { t, lang } = useLanguage();
  const { isReady, checked } = useTelegram();

  const closeSheet = useCallback(() => setSheet(null), []);

  useEffect(() => {
    // localStorage is browser-only, so the stored preference is applied after
    // mount (the inline script in layout.tsx already set the class pre-paint,
    // so this only syncs React's state with it).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(getStoredTheme());
  }, []);

  const isDev = process.env.NODE_ENV === "development";

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("habitflow-theme", theme);
  }, [theme]);

  /**
   * Position the active-tab underline.
   *
   * `checked` is load-bearing: this component renders null until the Telegram
   * probe finishes, so on the first pass the refs are all null and the effect
   * would leave the indicator at width 0 — invisible until the user happened to
   * tap a tab. `lang` matters because switching to Russian changes the label
   * widths the measurement is based on.
   */
  useEffect(() => {
    const measure = () => {
      const activeEl = tabRefs.current[tab];
      if (activeEl) {
        setIndicatorStyle({ left: activeEl.offsetLeft, width: activeEl.offsetWidth });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab, checked, lang]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  if (!checked) {
    return null;
  }

  if (!isReady && !isDev) {
    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "your_bot";
    const tg = typeof window !== "undefined" ? window.Telegram : undefined;
    const hasTg = !!tg;
    const hasWebApp = !!tg?.WebApp;
    // paddingTop must not be set separately from the padding shorthand — React
    // applies both keys to the same object and the shorthand wins, so the
    // 10vh offset was silently discarded.
    return (
      <div className="error-state" style={{ padding: "10vh 20px 20px" }}>
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
              onClick={() => setSheet("settings")}
              aria-label={t("settings")}
              style={{ minHeight: 36, minWidth: 36 }}
            >
              ⚙️
            </button>
            <button
              className="nav-icon-btn"
              onClick={toggleTheme}
              aria-label={t("toggleTheme")}
              style={{ minHeight: 36, minWidth: 36 }}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

        <div className="tab-bar">
          <button
            ref={(el) => { tabRefs.current.today = el; }}
            className={`tab-btn${tab === "today" ? " active" : ""}`}
            onClick={() => setTab("today")}
            aria-label={t("ariaToday")}
            style={{ minHeight: 40 }}
          >
            {t("tabToday")}
          </button>
          <button
            ref={(el) => { tabRefs.current.tasks = el; }}
            className={`tab-btn${tab === "tasks" ? " active" : ""}`}
            onClick={() => setTab("tasks")}
            aria-label={t("ariaTasks")}
            style={{ minHeight: 40 }}
          >
            {t("tabTasks")}
          </button>
          <button
            ref={(el) => { tabRefs.current.stats = el; }}
            className={`tab-btn${tab === "stats" ? " active" : ""}`}
            onClick={() => setTab("stats")}
            aria-label={t("ariaStats")}
            style={{ minHeight: 40 }}
          >
            {t("tabStats")}
          </button>
          <div
            className="tab-indicator"
            style={{ left: `${indicatorStyle.left}px`, width: `${indicatorStyle.width}px` }}
          />
        </div>
      </nav>

      {/* Routines and sharing have no tab of their own; these two buttons keep
          them reachable without adding navigation weight. */}
      {tab === "today" && (
        <div className={styles.quickActions}>
          <button
            type="button"
            className={styles.quickAction}
            onClick={() => setSheet("routines")}
          >
            🔁 {t("routines")}
          </button>
          <button
            type="button"
            className={styles.quickAction}
            onClick={() => setSheet("share")}
          >
            👥 {t("accountabilityPartner")}
          </button>
        </div>
      )}

      {tab === "today" ? (
        <TodayView />
      ) : tab === "tasks" ? (
        <TasksView />
      ) : (
        <StatsView />
      )}

      {/* The FAB used to render only on the Tasks tab, while the Today tab's
          empty state said "Tap + to create one" — pointing at a button that
          wasn't there. It is now available on both, labelled for what the tab
          is about. */}
      {tab !== "stats" && (
        <FAB
          onClick={() => setSheet("create")}
          label={tab === "tasks" ? t("newTask") : t("newHabit")}
        />
      )}
      {/* The key forces a fresh mount each time a sheet opens. These components
          only unmount their *output* when closed, so their useState survives —
          without the key, a half-finished edit reappears on the next open. */}
      <CreateModal
        key={sheet === "create" ? "open" : "closed"}
        open={sheet === "create"}
        onClose={closeSheet}
      />
      <SettingsSheet
        key={sheet === "settings" ? "open" : "closed"}
        open={sheet === "settings"}
        onClose={closeSheet}
      />
      <RoutinesSheet
        key={sheet === "routines" ? "open" : "closed"}
        open={sheet === "routines"}
        onClose={closeSheet}
      />
      <ShareSheet
        key={sheet === "share" ? "open" : "closed"}
        open={sheet === "share"}
        onClose={closeSheet}
      />
    </div>
  );
}
