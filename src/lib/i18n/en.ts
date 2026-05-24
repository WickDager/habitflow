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
  moodTrend: "Mood Trend",
  moodBreakdown: "Mood Breakdown",
  thisWeek: "Weekly Progress",
  outOf: "of",
  habitsCompleted: "{{count}} of {{total}} completed ({{pct}}%)",
  bestStreak: "best streak",
  totalCheckins: "total check-ins",
  perfectWeek: "All done! 100% this week.",
  streakDays: "days",

  // Mood trend descriptions (for SVG aria-label)
  moodDescHappy: "happy",
  moodDescNeutral: "neutral",
  moodDescSad: "sad",
  moodTrendLabel: "Mood trend (last 7 days): {{summary}}",
  noMoodData: "No mood data yet. Log your mood when saving habits.",
  noStreaksYet: "Complete a habit to start your streak.",

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
  taskDueTime: "Time (optional)",
  noTasksYet: "No tasks yet. Tap + to create one.",
  noHabitsYet: "No habits yet. Tap + to create one.",
  cancel: "Cancel",
  habitNameLabel: "Habit name",
  habitIconLabel: "Choose icon",
  editHabit: "Edit habit",
  deleteHabit: "Delete habit",
  deleteHabitConfirm: "Delete this habit? Your check-in history will be preserved.",
  save: "Save",
  delete: "Delete",
  editTask: "Edit task",
  deleteTask: "Delete task",
  deleteTaskConfirm: "Delete this task? This cannot be undone.",

  // Error screen (shown outside Telegram)
  appTitle: "HabitFlow",
  notInTelegram: "Please open HabitFlow directly within Telegram.",
  notInTelegramDesc:
    "Open your Telegram app, find your bot (@{{bot}}), and tap the menu button or send /start.",
} as const;

export type TranslationKeys = keyof typeof en;
