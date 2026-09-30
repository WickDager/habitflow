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

  // Mood trend descriptions (for SVG aria-label)
  moodDescHappy: "happy",
  moodDescNeutral: "neutral",
  moodDescSad: "sad",
  moodTrendLabel: "Mood trend (last 7 days): {{summary}}",
  noMoodData: "No mood data yet. Log your mood when saving habits.",
  noStreaksYet: "Complete a habit to start your streak.",

  // Bot messages
  botWelcome:
    "Welcome to HabitFlow — your daily routine, simplified.\n\nSmall habits, big results. Track what matters in seconds, stay consistent, and watch your streaks grow.\n\nTap below to get started! 🚀",
  botOpenApp: "Open HabitFlow",
  botReminderSettings: "Reminder settings:",
  botEnableReminders: "Enable reminders",
  botDisableReminders: "Disable reminders",

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

  // ── Feedback (toasts replace the no-op haptics on Telegram Web) ──
  saved: "Saved",
  deleted: "Deleted",
  undo: "Undo",
  retry: "Retry",
  sessionExpired: "Your session expired. Reopen HabitFlow from the bot.",
  rateLimited: "Too many requests — try again in a minute.",
  authFailed: "Couldn't verify you. Reopen HabitFlow from the bot.",
  serverError: "Something went wrong on the server. Try again.",

  // ── Settings / reminders ──
  settings: "Settings",
  toggleTheme: "Toggle theme",
  reminders: "Reminders",
  reminderEnabledLabel: "Daily reminders",
  morningPlan: "Morning plan",
  morningPlanHint: "A summary of your day, sent each morning",
  eveningReview: "Evening review",
  eveningReviewHint: "Wrap up the day and log your mood",
  middayNudge: "Midday nudge",
  middayNudgeHint: "One nudge if nothing is logged yet",
  weeklyReportLabel: "Weekly report",
  weeklyReportHint: "A recap every Sunday",
  timeMorning: "Morning",
  timeEvening: "Evening",
  timeNudge: "Nudge",
  quietHoursLabel: "Quiet hours",
  quietHoursHint: "No messages during these hours",
  quietHoursWarning: "This window covers every reminder time you picked — you won't be reminded at all.",
  quietFrom: "From",
  quietTo: "To",
  timezoneLabel: "Timezone",
  timezoneHint: "Detected from your device",
  maxPerDayLabel: "Max messages per day",
  settingsSaved: "Settings saved",

  // ── My Day ──
  habitsSection: "Habits",
  tasksSection: "Tasks",
  dueToday: "Due today",
  overdue: "Overdue",
  rollOver: "Move to today",
  rollOverAll: "Move all to today",
  rolledOver: "Moved to today",

  // ── Focus of the day ──
  focusToday: "Focus today",
  focusHint: "Pick up to 3 habits that matter most today",
  focusLimitReached: "You can pick up to 3",

  // ── Quick add ──
  quickAddPlaceholder: "Add a task — try \"call mom tomorrow 6pm\"",
  quickAddHint: "!1 for priority · #tag to label · tomorrow · fri 9am",
  add: "Add",
  taskAdded: "Task added",
  habitAdded: "Habit added",

  // ── Priorities & tags ──
  priorityLabel: "Priority",
  priorityNone: "None",
  priorityHigh: "High",
  priorityMedium: "Medium",
  priorityLow: "Low",
  tagsLabel: "Tags",
  addTag: "Add tag",
  newTagPlaceholder: "New tag name",
  noTagsYet: "No tags yet",
  filterAll: "All",
  filterToday: "Today",
  filterOverdue: "Overdue",
  filterHighPriority: "High priority",

  // Relative due-date labels (the weekday/month form is locale-formatted)
  dateToday: "Today",
  dateTomorrow: "Tomorrow",
  dateYesterday: "Yesterday",

  // ── Subtasks & notes ──
  subtasksLabel: "Steps",
  addSubtask: "Add a step",
  notesLabel: "Notes",
  notesPlaceholder: "Add notes…",
  subtaskProgress: "{{done}} of {{total}} steps",

  // ── Recurrence ──
  repeatLabel: "Repeat",
  repeatNever: "Never",
  repeatDaily: "Daily",
  repeatWeekly: "Weekly",
  repeatMonthly: "Monthly",

  // ── Routines ──
  routines: "Routines",
  newRoutine: "New routine",
  routineName: "Routine name",
  routineHabits: "Habits in this routine",
  routineDays: "Days",
  applyRoutine: "Apply",
  routineApplied: "{{count}} habits checked in",
  routineNotScheduled: "This routine isn't scheduled for today",
  noRoutinesYet: "No routines yet. Bundle habits you always do together.",
  deleteRoutine: "Delete routine",
  everyDay: "Every day",

  // ── Insights ──
  insights: "Insights",
  heatmapTitle: "Last 5 weeks",
  completionRate: "Completion rate",
  bestDayLabel: "Best day",
  moodByCompletion: "Mood by completion",
  moodOnCompleteDays: "On days you complete habits",
  moodOnMissedDays: "On days you don't",
  noInsightsYet: "Log a few days to unlock insights.",
  reportTitle: "Your week in HabitFlow",
  share: "Share",

  // ── Streaks & motivation ──
  graceDay: "Use a grace day",
  graceDayUsed: "Grace day used — streak protected",
  graceDayNone: "No grace days left this month",
  graceDayNotNeeded: "Your streak is already safe for yesterday",
  streakAtRiskTitle: "Streak at risk",
  graceDayHint: "Protects a streak for one missed day, once a month",

  // ── Sharing / accountability ──
  accountabilityPartner: "Accountability partner",
  partnerHint: "You'll both see this habit's streak",
  partnerInvite: "Invite",
  partnerPending: "Invite sent",
  partnerAccept: "Accept",
  partnerDecline: "Decline",
  partnerNone: "No partner yet",
  partnerTogether: "Together: {{count}} days",
  partnerCantInviteSelf: "You can't invite yourself",
  partnerNeedsStart: "They need to have started the bot first",
  partnerIdPlaceholder: "Telegram user ID (numbers only)",
  partnerYourId: "Your ID: {{id}}",

  // ── Bot messages ──
  botHelp:
    "Commands:\n/add <task> — add a task\n/today — today's plan\n/stats — your progress\n/settings — reminders",
  botTodayTitle: "Today, {{date}}",
  botNothingToday: "Nothing scheduled today. Enjoy it.",
  botDone: "Done",
  botLater: "Later",
  botSnoozed: "Snoozed for an hour",
  botSkipped: "Skipped for today",
  botAdded: "Added: {{title}}",
  botAddUsage: "Send /add followed by what you need to do.\nExample: /add pay rent tomorrow 9am",
  botTaskDue: "⏰ Due now: {{title}}",
  botMoodLogged: "Mood logged — thanks!",
  botMoodQuestion: "How did today go?",
  botForwardedSaved: "Saved as a task.",
  botMorningTitle: "Good morning, {{name}}",
  botMorningBody: "Today: {{habits}} habits · {{tasks}} tasks",
  botEveningTitle: "How did today go?",
  botEveningBody: "{{done}} of {{total}} habits done today.",
  botNothingLoggedYet: "Nothing logged yet today — {{count}} to go.",
  botStreakLine: "Longest streak: {{count}} days",
  botMuteHint: "Turn these off any time with /settings",

  // ── Task empty states that teach ──
  emptyTasksTeach: "Add your first task — try \"call mom Friday 6pm\"",
} as const;

export type TranslationKeys = keyof typeof en;
