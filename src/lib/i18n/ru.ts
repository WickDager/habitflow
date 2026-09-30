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

  // StatsView
  statsError: "Не удалось загрузить статистику.",
  moodTrend: "График настроения",
  moodBreakdown: "Общий фон",
  thisWeek: "Прогресс за неделю",
  outOf: "из",
  habitsCompleted: "{{count}} из {{total}} выполнено ({{pct}}%)",
  bestStreak: "лучшая серия",
  totalCheckins: "всего отметок",
  perfectWeek: "Идеальная неделя! 100%.",

  // Mood trend descriptions (for SVG aria-label)
  moodDescHappy: "отлично",
  moodDescNeutral: "нормально",
  moodDescSad: "плохо",
  moodTrendLabel: "Настроение (последние 7 дней): {{summary}}",
  noMoodData: "Нет данных о настроении. Отмечайте настроение при сохранении привычек.",
  noStreaksYet: "Выполните привычку, чтобы начать свою серию.",

  // Bot messages
  botWelcome:
    "Добро пожаловать в HabitFlow — ваш ежедневный помощник.\n\nМаленькие привычки приводят к большим результатам. Отслеживайте важное за секунды, сохраняйте темп и растите свои серии.\n\nНажмите кнопку ниже, чтобы начать! 🚀",
  botOpenApp: "Открыть HabitFlow",
  botReminderSettings: "Настройки напоминаний:",
  botEnableReminders: "Включить напоминания",
  botDisableReminders: "Отключить напоминания",

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
  taskDueTime: "Время (необязательно)",
  noTasksYet: "Нет задач. Нажмите + чтобы создать.",
  noHabitsYet: "Нет привычек. Нажмите + чтобы создать.",
  cancel: "Отмена",
  habitNameLabel: "Название привычки",
  iconChoose: "Иконка",
  iconCurrent: "Текущая",
  iconGroupMove: "Движение",
  iconGroupHealth: "Здоровье",
  iconGroupMind: "Разум",
  iconGroupHome: "Дом",
  iconGroupWork: "Работа",
  iconGroupSocial: "Общение",
  editHabit: "Редактировать",
  deleteHabit: "Удалить привычку",
  deleteHabitConfirm: "Удалить эту привычку? История отметок будет сохранена.",
  save: "Сохранить",
  delete: "Удалить",
  editTask: "Редактировать задачу",
  deleteTask: "Удалить задачу",
  deleteTaskConfirm: "Удалить эту задачу? Это действие нельзя отменить.",

  // Error screen (shown outside Telegram)
  appTitle: "HabitFlow",
  notInTelegram: "Пожалуйста, откройте HabitFlow напрямую в Telegram.",
  notInTelegramDesc:
    "Откройте приложение Telegram, найдите бота (@{{bot}}) и нажмите кнопку меню или отправьте /start.",

  // ── Обратная связь (тосты вместо неработающей тактильной отдачи в Telegram Web) ──
  saved: "Сохранено",
  deleted: "Удалено",
  undo: "Отменить",
  markDone: "Отметить выполненным",
  markUndone: "Снять отметку",
  rowActions: "Действия",
  close: "Закрыть",
  retry: "Повторить",
  sessionExpired: "Сессия истекла. Откройте HabitFlow заново из бота.",
  rateLimited: "Слишком много запросов — попробуйте через минуту.",
  authFailed: "Не удалось вас проверить. Откройте HabitFlow заново из бота.",
  serverError: "Ошибка на сервере. Попробуйте снова.",

  // ── Настройки / напоминания ──
  settings: "Настройки",
  reminders: "Напоминания",
  reminderEnabledLabel: "Ежедневные напоминания",
  morningPlan: "Утренний план",
  morningPlanHint: "Сводка дня каждое утро",
  eveningReview: "Вечерний итог",
  eveningReviewHint: "Подведите итог дня и отметьте настроение",
  middayNudge: "Дневное напоминание",
  middayNudgeHint: "Одно напоминание, если ещё ничего не отмечено",
  weeklyReportLabel: "Недельный отчёт",
  weeklyReportHint: "Итоги каждое воскресенье",
  timeMorning: "Утро",
  timeEvening: "Вечер",
  timeNudge: "Напоминание",
  quietHoursLabel: "Тихие часы",
  quietHoursHint: "Не отправлять сообщения в это время",
  quietHoursWarning: "Этот интервал перекрывает всё выбранное время напоминаний — вы не получите ни одного.",
  quietFrom: "С",
  quietTo: "До",
  timezoneLabel: "Часовой пояс",
  timezoneHint: "Определяется по устройству",
  maxPerDayLabel: "Максимум сообщений в день",
  settingsSaved: "Настройки сохранены",

  // ── Мой день ──
  habitsSection: "Привычки",
  tasksSection: "Задачи",
  dueToday: "Сегодня",
  overdue: "Просрочено",
  rollOver: "Перенести на сегодня",
  rollOverAll: "Перенести всё на сегодня",
  rolledOver: "Перенесено на сегодня",

  // ── Фокус дня ──
  focusToday: "Фокус дня",
  focusHint: "Выберите до 3 привычек, важных сегодня",
  focusLimitReached: "Можно выбрать до 3",

  // ── Быстрое добавление ──
  quickAddPlaceholder: "Добавить задачу — например «позвонить маме завтра в 18:00»",
  quickAddHint: "!1 — приоритет · #тег · завтра · пт 9:00",
  add: "Добавить",
  taskAdded: "Задача добавлена",
  habitAdded: "Привычка добавлена",

  // ── Приоритеты и теги ──
  priorityLabel: "Приоритет",
  priorityNone: "Нет",
  priorityHigh: "Высокий",
  priorityMedium: "Средний",
  priorityLow: "Низкий",
  tagsLabel: "Теги",
  addTag: "Добавить тег",
  newTagPlaceholder: "Название тега",
  noTagsYet: "Тегов пока нет",
  filterAll: "Все",
  filterToday: "Сегодня",
  filterOverdue: "Просроченные",
  filterHighPriority: "Высокий приоритет",

  // Относительные даты (день недели и месяц форматируются по локали)
  dateToday: "Сегодня",
  dateTomorrow: "Завтра",
  dateYesterday: "Вчера",

  // ── Шаги и заметки ──
  subtasksLabel: "Шаги",
  addSubtask: "Добавить шаг",
  notesLabel: "Заметки",
  notesPlaceholder: "Добавить заметку…",
  subtaskProgress: "{{done}} из {{total}} шагов",

  // ── Повтор ──
  repeatLabel: "Повтор",
  repeatNever: "Никогда",
  repeatDaily: "Ежедневно",
  repeatWeekly: "Еженедельно",
  repeatMonthly: "Ежемесячно",

  // ── Ритуалы ──
  routines: "Ритуалы",
  newRoutine: "Новый ритуал",
  routineName: "Название ритуала",
  routineHabits: "Привычки в ритуале",
  routineDays: "Дни",
  applyRoutine: "Применить",
  routineApplied: "Отмечено привычек: {{count}}",
  routineNotScheduled: "Эта рутина не запланирована на сегодня",
  noRoutinesYet: "Ритуалов пока нет. Объедините привычки, которые делаете вместе.",
  deleteRoutine: "Удалить ритуал",
  everyDay: "Каждый день",

  // ── Аналитика ──
  insights: "Аналитика",
  heatmapTitle: "Последние 5 недель",
  completionRate: "Процент выполнения",
  bestDayLabel: "Лучший день",
  moodByCompletion: "Настроение и выполнение",
  moodOnCompleteDays: "В дни, когда вы выполняете привычки",
  moodOnMissedDays: "В дни, когда нет",
  noInsightsYet: "Отмечайте несколько дней, чтобы увидеть аналитику.",
  reportTitle: "Ваша неделя в HabitFlow",
  share: "Поделиться",

  // ── Серии и мотивация ──
  graceDay: "Использовать выходной",
  graceDayUsed: "Выходной использован — серия сохранена",
  graceDayNone: "В этом месяце выходных больше нет",
  graceDayNotNeeded: "Ваша серия и так в безопасности за вчера",
  streakAtRiskTitle: "Серия под угрозой",
  graceDayHint: "Сохраняет серию за один пропущенный день, раз в месяц",

  // ── Совместные привычки ──
  accountabilityPartner: "Партнёр",
  partnerHint: "Вы оба будете видеть серию этой привычки",
  partnerInvite: "Пригласить",
  partnerPending: "Приглашение отправлено",
  partnerAccept: "Принять",
  partnerDecline: "Отклонить",
  partnerNone: "Партнёра пока нет",
  partnerTogether: "Вместе: {{count}} дней",
  partnerCantInviteSelf: "Нельзя пригласить себя",
  partnerNeedsStart: "Сначала человек должен запустить бота",
  partnerIdPlaceholder: "ID пользователя Telegram (только цифры)",
  partnerYourId: "Ваш ID: {{id}}",

  // ── Сообщения бота ──
  botHelp:
    "Команды:\n/add <задача> — добавить задачу\n/today — план на сегодня\n/stats — прогресс\n/settings — напоминания",
  botTodayTitle: "Сегодня, {{date}}",
  botNothingToday: "На сегодня ничего не запланировано. Отдыхайте.",
  botDone: "Готово",
  botLater: "Позже",
  botSnoozed: "Отложено на час",
  botSkipped: "Пропущено на сегодня",
  botAdded: "Добавлено: {{title}}",
  botAddUsage: "Отправьте /add и текст задачи.\nНапример: /add оплатить аренду завтра в 9:00",
  botTaskDue: "⏰ Пора: {{title}}",
  botMoodLogged: "Настроение отмечено — спасибо!",
  botMoodQuestion: "Как прошёл день?",
  botForwardedSaved: "Сохранено как задача.",
  botMorningTitle: "Доброе утро, {{name}}",
  botMorningBody: "Сегодня: привычек — {{habits}} · задач — {{tasks}}",
  botEveningTitle: "Как прошёл день?",
  botEveningBody: "Сегодня выполнено {{done}} из {{total}} привычек.",
  botNothingLoggedYet: "Сегодня ещё ничего не отмечено — осталось {{count}}.",
  botStreakLine: "Лучшая серия: {{count}} дней",
  botMuteHint: "Отключить можно командой /settings",

  // ── Пустые состояния ──
  emptyTasksTeach: "Добавьте первую задачу — например «позвонить маме в пятницу в 18:00»",
};
