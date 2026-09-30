import { serverClient } from "./supabase";
import { sendMessage } from "./telegram";
import { en } from "./i18n/en";
import { ru } from "./i18n/ru";
import { addDays } from "./dates";
import {
  contextFor,
  dedupeKey,
  dueKinds,
  isKindEnabled,
  isQuietHour,
  localTimeInTimezone,
  slotHourFor,
  type ReminderKind,
} from "./reminders";
import type { UserRow } from "./database.types";

/**
 * Reminder composition + delivery.
 *
 * Two layers live here:
 *  1. `send*` helpers — compose and send one message. User-initiated callers
 *     (the bot answering /today) use these directly.
 *  2. `runReminderTick` — the scheduled engine: it decides who is due, applies
 *     the etiquette (daily cap, once-per-day ledger) and calls the helpers.
 *     `/api/cron/tick` and `/api/cron` are thin auth wrappers over it, so the
 *     two entry points cannot drift apart.
 */

// ── Translation ──────────────────────────────────────────────────────────────

/** `(key, params?) => string`, the same {{var}} convention as the client's `t`. */
export type NotifyT = (key: string, params?: Record<string, string | number>) => string;

const tables: Record<string, Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  ru: ru as unknown as Record<string, string>,
};

/** Same language mapping as the bot webhook: ru/uk/be share the ru table. */
export function notifyT(langCode: string | null | undefined): NotifyT {
  const table =
    langCode === "ru" || langCode === "uk" || langCode === "be" ? tables.ru : tables.en;
  return (key, params) => interpolate(table[key] ?? key, params);
}

/**
 * Accepts either a `NotifyT` or a raw translation table (`t.botMorningTitle`),
 * because callers differ in which they hold — `/api/bot` has historically used
 * the table object. Normalising here keeps a mismatched call from throwing at
 * runtime.
 */
type TranslateLike = NotifyT | Record<string, string>;

function asT(t: TranslateLike): NotifyT {
  if (typeof t === "function") return t;
  return (key, params) => interpolate(t[key] ?? key, params);
}

/** The client's interpolate, mirrored so server messages render identically. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? `{{${key}}}`));
}

/**
 * `sendMessage` defaults to parse_mode HTML, so a name or task title containing
 * `<`, `>` or `&` would make Telegram reject the whole call ("can't parse
 * entities") and silently lose the reminder. Anything the user authored and we
 * interpolate must go through this.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Mini App URL, with the same env fallback chain as src/lib/telegram.ts. */
function appUrl(): string {
  const productionDomain = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://habitflow-pi-ten.vercel.app";

  return productionDomain.replace(/^https?:\/\//, "https://");
}

interface Message {
  text: string;
  replyMarkup: unknown;
}

/** The one-button keyboard that opens the Mini App. */
export function openAppKeyboard(t: TranslateLike) {
  const tr = asT(t);
  return {
    inline_keyboard: [[{ text: tr("botOpenApp"), web_app: { url: appUrl() } }]],
  };
}

/**
 * One-tap completion buttons for the habits still outstanding today.
 *
 * Capped at 5: a reminder that fills the screen gets dismissed, and the text
 * still states the true remaining count. The app button covers the rest.
 * Labels are plain text — inline keyboard buttons are not HTML-parsed, so the
 * habit name needs no escaping here (unlike message bodies).
 */
function habitDoneRows(day: DayData) {
  return day.habitsTodoList.slice(0, 5).map((habit) => [
    {
      text: `✅ ${habit.icon} ${habit.name}`.replace(/\s+/g, " ").trim(),
      callback_data: `done:${habit.id}:${day.localDate}`,
    },
  ]);
}

/** Habit buttons (if any) followed by the open-the-app button. */
function planKeyboard(day: DayData, tr: NotifyT): { inline_keyboard: unknown[][] } {
  return {
    inline_keyboard: [
      ...habitDoneRows(day),
      [{ text: tr("botOpenApp"), web_app: { url: appUrl() } }],
    ],
  };
}

// ── Data the composers need ──────────────────────────────────────────────────

export interface OpenTodo {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
}

export interface DayData {
  /** The user's local calendar date, YYYY-MM-DD. */
  localDate: string;
  /** Active (not archived) habits. */
  habitsTotal: number;
  /** Habits checked in as completed today. */
  habitsDone: number;
  /** Habits still to do today. */
  habitsTodo: number;
  /** Open tasks due today, overdue, or with no date at all. */
  tasksTodo: number;
  /** Longest current streak across the user's habits. */
  longestStreak: number;
  /** Open tasks carrying a due_time — used for the per-task reminders. */
  openTodos: OpenTodo[];
  /**
   * Habits not yet completed today, in list order. Carried so the reminder can
   * offer one-tap "done" buttons instead of only a link into the app — tapping
   * through a WebView to tick one box is the friction this removes.
   */
  habitsTodoList: OutstandingHabit[];
}

export interface OutstandingHabit {
  id: string;
  name: string;
  icon: string;
}

export interface WeekData {
  /** The user's local date; the window is the 7 days ending here. */
  localDate: string;
  /** Completions in the last 7 days. */
  done: number;
  /** Habit-days available in the window (habits × 7) — progress denominator. */
  total: number;
  longestStreak: number;
}

/**
 * Open (not completed) top-level tasks that belong to today: due today, already
 * overdue, or with no date at all — an undated task is today's task in this UI.
 * Subtasks are excluded; they are steps of their parent, not reminders.
 */
export async function loadOpenTodos(userId: string, localDate: string): Promise<OpenTodo[]> {
  const sb = serverClient();

  const { data, error } = await sb
    .from("todos")
    .select("id, title, due_date, due_time")
    .eq("user_id", userId)
    .eq("is_completed", false)
    .is("parent_id", null)
    .or(`due_date.is.null,due_date.lte.${localDate}`);

  if (error) throw new Error(`loadOpenTodos: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    due_date: row.due_date,
    due_time: row.due_time,
  }));
}

/**
 * Everything a day's messages need, so the tick engine, the bot's /today
 * command and the weekly report all count the same rows the same way.
 */
export async function loadDayData(userId: string, localDate: string): Promise<DayData> {
  const sb = serverClient();

  const [habitsRes, checkinsRes, streaksRes, openTodos] = await Promise.all([
    sb
      .from("habits")
      .select("id, name, icon, sort_order")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    sb
      .from("checkins")
      .select("habit_id")
      .eq("user_id", userId)
      .eq("date", localDate)
      .eq("completed", true),
    sb.from("habit_streaks").select("current_streak").eq("user_id", userId),
    loadOpenTodos(userId, localDate),
  ]);

  const firstError = habitsRes.error || checkinsRes.error || streaksRes.error;
  if (firstError) throw new Error(`loadDayData: ${firstError.message}`);

  const habits = habitsRes.data ?? [];
  const doneIds = new Set((checkinsRes.data ?? []).map((row) => row.habit_id));
  const habitsTotal = habits.length;
  const habitsDone = doneIds.size;

  return {
    localDate,
    habitsTotal,
    habitsDone,
    habitsTodo: Math.max(0, habitsTotal - habitsDone),
    tasksTodo: openTodos.length,
    habitsTodoList: habits
      .filter((habit) => !doneIds.has(habit.id))
      .map((habit) => ({
        id: habit.id,
        name: habit.name,
        icon: habit.icon ?? "",
      })),
    longestStreak: (streaksRes.data ?? []).reduce(
      (max, row) => Math.max(max, row.current_streak ?? 0),
      0
    ),
    openTodos,
  };
}

export async function loadWeekData(userId: string, localDate: string): Promise<WeekData> {
  const sb = serverClient();
  const weekStart = addDays(localDate, -6);

  const [habitsRes, checkinsRes, streaksRes] = await Promise.all([
    sb.from("habits").select("id").eq("user_id", userId).is("archived_at", null),
    sb
      .from("checkins")
      .select("id")
      .eq("user_id", userId)
      .eq("completed", true)
      .gte("date", weekStart)
      .lte("date", localDate),
    sb.from("habit_streaks").select("current_streak").eq("user_id", userId),
  ]);

  const firstError = habitsRes.error || checkinsRes.error || streaksRes.error;
  if (firstError) throw new Error(`loadWeekData: ${firstError.message}`);

  const habitsTotal = habitsRes.data?.length ?? 0;

  return {
    localDate,
    done: checkinsRes.data?.length ?? 0,
    total: habitsTotal * 7,
    longestStreak: (streaksRes.data ?? []).reduce(
      (max, row) => Math.max(max, row.current_streak ?? 0),
      0
    ),
  };
}

// ── Composers ────────────────────────────────────────────────────────────────
// Each returns null when there is genuinely nothing to say. The engine treats
// null as "skip this kind entirely", so no empty "you have nothing to do"
// message is ever sent and no ledger row is burned on one.

export function composeMorning(user: UserRow, day: DayData, t: TranslateLike): Message | null {
  const tr = asT(t);
  // No habits and nothing on the task list — there is no plan to report.
  if (day.habitsTotal === 0 && day.tasksTodo === 0) return null;

  const text = [
    tr("botMorningTitle", { name: escapeHtml(user.first_name) }),
    tr("botMorningBody", { habits: day.habitsTodo, tasks: day.tasksTodo }),
    "",
    tr("botMuteHint"),
  ].join("\n");

  return { text, replyMarkup: planKeyboard(day, tr) };
}

export function composeEvening(user: UserRow, day: DayData, t: TranslateLike): Message | null {
  const tr = asT(t);
  if (day.habitsTotal === 0) return null;

  const text = [
    tr("botEveningTitle"),
    tr("botEveningBody", { done: day.habitsDone, total: day.habitsTotal }),
    "",
    tr("botMoodQuestion"),
  ].join("\n");

  // Emoji pairing mirrors TodayView's mood picker (1 happy, 2 neutral, 3 sad).
  // The local date rides on each button so the webhook files the mood under the
  // day the review was about, not the day the tap happened to arrive.
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: `😊 ${tr("moodHappy")}`, callback_data: `mood:1:${day.localDate}` },
        { text: `😐 ${tr("moodNeutral")}`, callback_data: `mood:2:${day.localDate}` },
        { text: `😞 ${tr("moodSad")}`, callback_data: `mood:3:${day.localDate}` },
      ],
      [{ text: tr("botOpenApp"), web_app: { url: appUrl() } }],
    ],
  };

  return { text, replyMarkup };
}

export function composeNudge(user: UserRow, day: DayData, t: TranslateLike): Message | null {
  const tr = asT(t);
  // Only ever for someone with habits who has logged nothing today.
  if (day.habitsTotal === 0 || day.habitsDone > 0) return null;

  const text = [tr("botNothingLoggedYet", { count: day.habitsTodo }), "", tr("botMuteHint")].join(
    "\n"
  );

  return { text, replyMarkup: planKeyboard(day, tr) };
}

export function composeTask(user: UserRow, todo: OpenTodo, t: TranslateLike): Message {
  const tr = asT(t);
  // Escape before interpolating: sendMessage defaults to parse_mode HTML, and
  // a title containing "<" would otherwise make Telegram reject the message.
  const text = tr("botTaskDue", { title: escapeHtml(todo.title) });

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: tr("botDone"), callback_data: `todo_done:${todo.id}` },
          { text: tr("botLater"), callback_data: `todo_later:${todo.id}` },
        ],
        [{ text: tr("botOpenApp"), web_app: { url: appUrl() } }],
      ],
    },
  };
}

export function composeWeekly(user: UserRow, week: WeekData, t: TranslateLike): Message | null {
  const tr = asT(t);
  if (week.total === 0) return null;

  const pct = Math.round((week.done / week.total) * 100);
  const text = [
    tr("reportTitle"),
    tr("habitsCompleted", { count: week.done, total: week.total, pct }),
    tr("botStreakLine", { count: week.longestStreak }),
  ].join("\n");

  // TODO: replace this text recap with the generated report card once
  // `/api/report?image=1` (owned by another agent) is live — send it with
  // sendPhotoBuffer/sendPhotoWithButton and keep this text as the caption.
  return { text, replyMarkup: openAppKeyboard(tr) };
}

// ── Public send helpers ──────────────────────────────────────────────────────
// These compose AND send, and deliberately do not consult reminder_log or the
// daily cap: they are for user-initiated paths (the bot answering /today), where
// the user asked, so the once-per-day ledger must not suppress the reply.
// Scheduled delivery goes through the tick engine, which claims first.

async function deliver(user: UserRow, message: Message | null): Promise<boolean> {
  if (!message || !user.chat_id) return false;
  await sendMessage(user.chat_id, message.text, { replyMarkup: message.replyMarkup });
  return true;
}

/** Morning plan. Returns true when a message was actually sent. */
export async function sendMorningPlan(
  user: UserRow,
  profileData: DayData,
  t: TranslateLike
): Promise<boolean> {
  return deliver(user, composeMorning(user, profileData, t));
}

/** Evening wrap-up with the mood buttons. */
export async function sendEveningReview(
  user: UserRow,
  profileData: DayData,
  t: TranslateLike
): Promise<boolean> {
  return deliver(user, composeEvening(user, profileData, t));
}

/** Midday nudge — only meaningful for someone who has logged nothing today. */
export async function sendNudge(
  user: UserRow,
  profileData: DayData,
  t: TranslateLike
): Promise<boolean> {
  return deliver(user, composeNudge(user, profileData, t));
}

/** Per-task reminder with [Done] / [Later]. */
export async function sendTaskReminder(
  user: UserRow,
  todo: OpenTodo,
  t: TranslateLike
): Promise<boolean> {
  return deliver(user, composeTask(user, todo, t));
}

/** Weekly recap. */
export async function sendWeeklyReport(
  user: UserRow,
  week: WeekData,
  t: TranslateLike
): Promise<boolean> {
  return deliver(user, composeWeekly(user, week, t));
}

// ── Etiquette: the delivery ledger ───────────────────────────────────────────

/**
 * Claim one send. Returns true only for the caller that created the row — a
 * duplicate key (Postgres 23505) means an earlier tick in the same slot already
 * sent it. This is what makes an every-10-minutes scheduler safe.
 */
export async function claimSend(
  userId: string,
  kind: ReminderKind,
  localDate: string,
  discriminator?: string
): Promise<boolean> {
  const sb = serverClient();
  const { data, error } = await sb
    .from("reminder_log")
    .insert({
      user_id: userId,
      kind,
      local_date: localDate,
      dedupe_key: dedupeKey(userId, kind, localDate, discriminator),
    })
    .select("id");

  if (error) {
    if (error.code === "23505") return false; // lost the race — already sent
    throw new Error(`claimSend: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Hand a claim back after a failed send so a later tick inside the same slot
 * hour can retry. The trade-off is deliberate: if Telegram accepted the call but
 * the response was lost, the user may get it twice — a duplicate reminder is
 * cheaper than one that never arrives.
 */
export async function releaseSend(
  userId: string,
  kind: ReminderKind,
  localDate: string,
  discriminator?: string
): Promise<void> {
  const sb = serverClient();
  await sb
    .from("reminder_log")
    .delete()
    .eq("dedupe_key", dedupeKey(userId, kind, localDate, discriminator));
}

/** Reminder messages already sent to this user on this local date. */
export async function countSendsToday(userId: string, localDate: string): Promise<number> {
  const sb = serverClient();
  // `head: true` returns no rows, so the count must be read from `count` —
  // testing `data` here (as the old cron route did) is always null.
  const { count } = await sb
    .from("reminder_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("local_date", localDate);

  return count ?? 0;
}

/** Under the user's daily message budget? */
export async function underDailyCap(user: UserRow, localDate: string): Promise<boolean> {
  const cap = user.max_daily_messages ?? 6;
  if (cap <= 0) return false;
  return (await countSendsToday(user.id, localDate)) < cap;
}

// ── The tick engine ──────────────────────────────────────────────────────────

/** The scheduler runs every ~10 minutes, so a due_time is matched in that window. */
const TASK_WINDOW_MINUTES = 10;

/**
 * Bot API allows ~30 messages/second overall and ~1/second per chat, so
 * different chats only need the global gap while two messages to the same chat
 * in one tick need the per-chat one. Keeping the batch quick matters: a
 * serverless invocation has a wall-clock budget and a slow batch would be cut
 * off mid-run.
 */
const GAP_OTHER_CHAT_MS = 35;
const GAP_SAME_CHAT_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TickSummary {
  checked: number;
  sent: number;
  skipped: number;
}

export interface TickOptions {
  now?: Date;
  /**
   * The daily Vercel cron cannot land on every user's local hour, so on a Sunday
   * it also runs the weekly report for anyone already past their weekly slot.
   * The ledger keeps that from double-sending when the 10-minute tick is healthy
   * too.
   */
  forceWeeklyOnSunday?: boolean;
}

/** "HH:MM" (or "HH:MM:SS") → minutes since local midnight. */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Tasks whose due_time fell inside the last `TASK_WINDOW_MINUTES`. Compared on
 * hour:minute only, so the app's "HH:MM" and Postgres' "HH:MM:SS" both match,
 * and the modulo handles a window that wraps past local midnight.
 */
export function dueTasksFor(
  user: UserRow,
  todos: OpenTodo[],
  localDate: string,
  now: Date
): OpenTodo[] {
  const nowMinutes = minutesOfDay(localTimeInTimezone(user.timezone, now));

  return todos.filter((todo) => {
    if (!todo.due_time) return false;
    // Only today's tasks — an overdue one was already reminded about on its day.
    if (todo.due_date && todo.due_date !== localDate) return false;

    const delta = (nowMinutes - minutesOfDay(todo.due_time) + 1440) % 1440;
    return delta <= TASK_WINDOW_MINUTES;
  });
}

/**
 * Run one batch: load candidates, decide what is due, apply the etiquette, send,
 * then report. Never throws on behalf of one user — a bad row must not abort the
 * batch.
 */
export async function runReminderTick(opts: TickOptions = {}): Promise<TickSummary> {
  const now = opts.now ?? new Date();
  const sb = serverClient();

  const { data: users, error } = await sb
    .from("users")
    .select("*")
    .eq("reminder_enabled", true)
    .not("chat_id", "is", null);

  if (error) throw new Error(`runReminderTick: ${error.message}`);
  if (!users || users.length === 0) return { checked: 0, sent: 0, skipped: 0 };

  const summary: TickSummary = { checked: 0, sent: 0, skipped: 0 };
  let lastChatId: number | null = null;

  for (const user of users) {
    summary.checked++;
    try {
      const sent = await runForUser(user, now, opts.forceWeeklyOnSunday === true);
      summary.sent += sent;
      if (sent === 0) summary.skipped++;

      if (sent > 0) {
        await sleep(user.chat_id === lastChatId ? GAP_SAME_CHAT_MS : GAP_OTHER_CHAT_MS);
        lastChatId = user.chat_id;
      }
    } catch (err) {
      summary.skipped++;
      console.error(`tick: user ${user.id} failed`, err);
    }
  }

  return summary;
}

/** Everything one user is due right now. Returns how many messages went out. */
async function runForUser(user: UserRow, now: Date, forceWeekly: boolean): Promise<number> {
  const ctx = contextFor(user, now);
  const due = dueKinds(user, now);
  const quiet = isQuietHour(user, ctx.localHour);

  // A Sunday catch-up, for the daily fallback cron only.
  const weeklySlot = slotHourFor(user, "weekly") ?? 21;
  const forcedWeekly =
    forceWeekly &&
    !quiet &&
    ctx.localWeekday === 0 &&
    ctx.localHour >= weeklySlot &&
    !due.some((d) => d.kind === "weekly");

  const wantsTasks = !quiet && isKindEnabled(user, "task");

  // Cheap exit: outside every slot hour and with no task pass to run, this user
  // needs no queries at all.
  if (due.length === 0 && !forcedWeekly && !wantsTasks) return 0;

  const t = notifyT(user.language_code);
  const needsDay = due.length > 0 || forcedWeekly;

  // The task pass only needs the open todos, so a plain tick (no digest due)
  // pays for one query instead of the full day load.
  const day = needsDay ? await loadDayData(user.id, ctx.localDate) : null;
  const openTodos = day ? day.openTodos : await loadOpenTodos(user.id, ctx.localDate);

  let sent = 0;

  // Bot API allows roughly one message per second per chat, so a second message
  // in this same tick waits at the per-chat gap.
  const sendOne = async (
    kind: ReminderKind,
    data: { day?: DayData; week?: WeekData; todo?: OpenTodo }
  ) => {
    if (sent > 0) await sleep(GAP_SAME_CHAT_MS);
    if (await sendScheduled(user, kind, ctx.localDate, t, data)) sent++;
  };

  for (const { kind } of due) {
    await sendOne(kind, { day: day! });
  }

  if (forcedWeekly) {
    const week = await loadWeekData(user.id, ctx.localDate);
    await sendOne("weekly", { day: day!, week });
  }

  if (wantsTasks) {
    for (const todo of dueTasksFor(user, openTodos, ctx.localDate, now)) {
      await sendOne("task", { day: day ?? undefined, todo });
    }
  }

  return sent;
}

/**
 * The etiquette gate, in this order: content → daily cap → atomic claim → send.
 *
 * The cap is checked BEFORE the claim so a user already at their limit is
 * skipped without consuming a ledger row (and therefore a slot); the claim is
 * what makes a repeated tick a no-op.
 */
async function sendScheduled(
  user: UserRow,
  kind: ReminderKind,
  localDate: string,
  t: NotifyT,
  data: { day?: DayData; week?: WeekData; todo?: OpenTodo }
): Promise<boolean> {
  const message = composeFor(kind, user, t, data);
  if (!message) return false; // nothing to say — no claim, no send

  if (!(await underDailyCap(user, localDate))) return false;

  const discriminator = kind === "task" ? data.todo?.id : undefined;
  if (!(await claimSend(user.id, kind, localDate, discriminator))) return false;

  try {
    await sendMessage(user.chat_id!, message.text, { replyMarkup: message.replyMarkup });
    return true;
  } catch (err) {
    // Give the claim back so the next tick in this hour can retry.
    await releaseSend(user.id, kind, localDate, discriminator);
    console.error(`tick: send ${kind} to user ${user.id} failed`, err);
    return false;
  }
}

function composeFor(
  kind: ReminderKind,
  user: UserRow,
  t: NotifyT,
  data: { day?: DayData; week?: WeekData; todo?: OpenTodo }
): Message | null {
  switch (kind) {
    case "morning":
      return data.day ? composeMorning(user, data.day, t) : null;
    case "evening":
      return data.day ? composeEvening(user, data.day, t) : null;
    case "nudge":
      return data.day ? composeNudge(user, data.day, t) : null;
    case "weekly":
      return data.week ? composeWeekly(user, data.week, t) : null;
    case "task":
      return data.todo ? composeTask(user, data.todo, t) : null;
  }
}
