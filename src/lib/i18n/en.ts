export const en = {
  // Tabs
  tabToday: "Today",
  tabTasks: "Tasks",
  tabStats: "Stats",

  // TodayView
  loadingError: "Failed to load habits. Pull down to retry.",
  offlineBanner: "Offline — changes will sync when you reconnect",
  celebration: "All done!",
  moodLabel: "How are you feeling?",
  moodHappy: "Happy",
  moodNeutral: "Neutral",
  moodSad: "Sad",
  saveCheckin: "Save Check-In",
  saving: "Saving…",
  saveFailed: "Save failed. Try again.",

  // Habit aria-labels
  habitCompletedLabel: "completed",
  habitNotCompletedLabel: "not completed",
  loadingHabitsLabel: "Loading habits…",

  // StatsView
  statsError: "Failed to load stats.",
  moodTrend: "Mood trend",
  thisWeek: "This week",
  habitsCompleted: "{{count}} of {{total}} habits completed this week",
  streakDays: "days",

  // Mood trend descriptions (for SVG aria-label)
  moodDescHappy: "happy",
  moodDescNeutral: "neutral",
  moodDescSad: "sad",
  moodTrendLabel: "Mood trend (last 7 days): {{summary}}",

  // Bot messages
  botWelcome:
    "Track your daily habits in under 10 seconds.\n\nTap below to open HabitFlow.",
  botOpenApp: "Open HabitFlow",
  botReminderSettings: "Reminder settings:",
  botEnableReminders: "Enable reminders",
  botDisableReminders: "Disable reminders",
  botReminderMessage:
    "You haven’t checked in today. Tap below to log your habits.",
  botLogHabits: "Log habits",

  // Settings / language
  language: "Language",

  // a11y
  ariaToday: "Today’s habits",
  ariaTasks: "Tasks",
  ariaStats: "View statistics",

  // Tasks
  newHabit: "New Habit",
  newTask: "New Task",
  taskTitle: "Task title",
  taskDueDate: "Due date (optional)",
  noTasksYet: "No tasks yet. Tap + to create one.",
  cancel: "Cancel",
  habitNameLabel: "Habit name",
  habitIconLabel: "Choose icon",

  // Error screen (shown outside Telegram)
  appTitle: "HabitFlow",
  notInTelegram: "Please open HabitFlow directly within Telegram.",
} as const;

export type TranslationKeys = keyof typeof en;
