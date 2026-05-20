"use client";

import { useState } from "react";
import { TodayView } from "@/components/TodayView";
import { StatsView } from "@/components/StatsView";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n";

type Tab = "today" | "stats";

export default function Home() {
  const [tab, setTab] = useState<Tab>("today");
  const { t } = useLanguage();

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
          className={`tab-btn ${tab === "stats" ? "active" : ""}`}
          onClick={() => setTab("stats")}
          aria-label={t("ariaStats")}
          style={{ minHeight: 44 }}
        >
          {t("tabStats")}
        </button>
        <LanguageSwitcher />
      </nav>

      {tab === "today" ? <TodayView /> : <StatsView />}
    </div>
  );
}
