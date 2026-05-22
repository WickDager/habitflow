"use client";

import { useState } from "react";
import { TodayView } from "@/components/TodayView";
import { TasksView } from "@/components/TasksView";
import { StatsView } from "@/components/StatsView";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { FAB } from "@/components/FAB";
import { CreateModal } from "@/components/CreateModal";
import { useLanguage } from "@/lib/i18n";

type Tab = "today" | "tasks" | "stats";

export default function Home() {
  const [tab, setTab] = useState<Tab>("today");
  const [modalOpen, setModalOpen] = useState(false);
  const { t } = useLanguage();

  const [notInTelegram] = useState(() =>
    typeof window !== "undefined" &&
    !window.Telegram?.WebApp &&
    process.env.NODE_ENV !== "development"
  );

  if (notInTelegram) {
    return (
      <div className="error-state" style={{ paddingTop: "40vh" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 12 }}>HabitFlow</h1>
        <p>Please open HabitFlow directly within Telegram.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === "today" ? "active" : ""}`}
          onClick={() => setTab("today")}
          aria-label={t("ariaToday")}
          style={{ minHeight: 44 }}
        >
          {t("tabToday")}
        </button>
        <button
          className={`tab-btn ${tab === "tasks" ? "active" : ""}`}
          onClick={() => setTab("tasks")}
          aria-label={t("tabTasks")}
          style={{ minHeight: 44 }}
        >
          {t("tabTasks")}
        </button>
        <button
          className={`tab-btn ${tab === "stats" ? "active" : ""}`}
          onClick={() => setTab("stats")}
          aria-label={t("ariaStats")}
          style={{ minHeight: 44 }}
        >
          {t("tabStats")}
        </button>
        <LanguageSwitcher />
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
