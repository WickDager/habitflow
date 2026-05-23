import type { en } from "./en";

export const ru: Record<keyof typeof en, string> = {
  // Tabs
  tabToday: "Сегодня",
  tabTasks: "Задачи",
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
  noMoodData: "Нет данных о настроении. Отмечайте настроение при сохранении привычек.",
  noStreaksYet: "Выполните привычку, чтобы начать серию.",

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
  ariaTasks: "Задачи",
  ariaStats: "Просмотр статистики",

  // Tasks
  newHabit: "Новая привычка",
  newTask: "Новая задача",
  taskTitle: "Название задачи",
  taskDueDate: "Срок (необязательно)",
  noTasksYet: "Нет задач. Нажмите + чтобы создать.",
  cancel: "Отмена",
  habitNameLabel: "Название привычки",
  habitIconLabel: "Выберите иконку",

  // Error screen (shown outside Telegram)
  appTitle: "HabitFlow",
  notInTelegram: "Пожалуйста, откройте HabitFlow напрямую в Telegram.",
  notInTelegramDesc:
    "Откройте приложение Telegram, найдите бота (@{{bot}}) и нажмите кнопку меню или отправьте /start.",
};
