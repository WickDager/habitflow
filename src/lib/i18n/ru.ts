import type { en } from "./en";

export const ru: Record<keyof typeof en, string> = {
  // Tabs
  tabToday: "Сегодня",
  tabStats: "Статистика",

  // TodayView
  loadingError: "Не удалось загрузить привычки. Потяните вниз, чтобы повторить.",
  offlineBanner: "Офлайн — изменения синхронизируются при подключении",
  celebration: "Готово!",
  moodLabel: "Как вы себя чувствуете?",
  moodHappy: "Отлично",
  moodNeutral: "Нормально",
  moodSad: "Плохо",
  saveCheckin: "Сохранить",
  saving: "Сохранение…",
  saveFailed: "Ошибка сохранения. Попробуйте снова.",

  // Habit aria-labels
  habitCompletedLabel: "выполнено",
  habitNotCompletedLabel: "не выполнено",
  loadingHabitsLabel: "Загрузка привычек…",

  // StatsView
  statsError: "Не удалось загрузить статистику.",
  moodTrend: "Настроение",
  thisWeek: "Эта неделя",
  habitsCompleted: "{{count}} из {{total}} привычек выполнено на этой неделе",
  streakDays: "дн",

  // Mood trend descriptions (for SVG aria-label)
  moodDescHappy: "отлично",
  moodDescNeutral: "нормально",
  moodDescSad: "плохо",
  moodTrendLabel: "Настроение (последние 7 дней): {{summary}}",

  // Bot messages
  botWelcome:
    "Отслеживайте ежедневные привычки за 10 секунд.\n\nНажмите кнопку ниже, чтобы открыть HabitFlow.",
  botOpenApp: "Открыть HabitFlow",
  botReminderSettings: "Настройки напоминаний:",
  botEnableReminders: "Включить напоминания",
  botDisableReminders: "Отключить напоминания",
  botReminderMessage:
    "Вы ещё не отметили привычки сегодня. Нажмите кнопку ниже.",
  botLogHabits: "Отметить привычки",

  // Settings / language
  language: "Язык",

  // a11y
  ariaToday: "Привычки на сегодня",
  ariaStats: "Просмотр статистики",
};
