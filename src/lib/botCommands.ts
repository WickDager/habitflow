import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRow } from "@/lib/database.types";
import { serverClient } from "@/lib/supabase";
import { answerCallbackQuery, editMessageText, sendMessage } from "@/lib/telegram";
import { en } from "@/lib/i18n/en";
import { ru } from "@/lib/i18n/ru";
import { parseTaskInput } from "@/lib/nlpDate";
import { dateInTimezone, parseDateString, toTimeString } from "@/lib/dates";
import { normalizeTagName } from "@/lib/schemas";
import { reminderKinds } from "@/lib/reminders";

/**
 * Bot command and callback handling, kept out of the webhook route so the
 * logic is plain async functions over a Supabase client — testable without
 * an HTTP request and without Telegram.
 *
 * The route owns the things that are genuinely HTTP concerns: the webhook
 * secret check, the `/start` welcome media, and the always-200 response.
 */

type Db = SupabaseClient<Database>;

/**
 * The shape every translation object in `@/lib/i18n` satisfies. Widening `en`'s
 * literal types to `string` is what lets `ru` (a `Record<keyof typeof en, string>`)
 * be returned from the same function as `en`.
 */
export type BotTranslations = { [K in keyof typeof en]: string };

/**
 * Server-side language picker. Mirrors the client's rule: the three East Slavic
 * codes fall back to Russian, everything else to English.
 */
export function botT(langCode: string | undefined): BotTranslations {
  return langCode === "ru" || langCode === "uk" || langCode === "be" ? ru : en;
}

/** `{{var}}` interpolation. Unknown placeholders are left alone, not blanked. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}

/**
 * Habit names, task titles and tag names are user data and every message here
 * is sent with parse_mode=HTML, so they must be escaped or a name containing
 * "<" silently swallows the rest of the message.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Telegram update shapes ──
// Only the fields this module reads. Deliberately structural rather than the
// full Bot API types: it keeps the handler honest about what it depends on and
// makes hand-built fixtures in tests trivial.

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

interface TgChat {
  id: number;
}

type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};

interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  /** The buttons the message was sent with; needed to edit without dropping them. */
  reply_markup?: { inline_keyboard?: InlineButton[][] };
  /** Bot API 7+ forward metadata. */
  forward_origin?: unknown;
  /** Legacy forward fields, still sent by older Telegram clients. */
  forward_from?: unknown;
  forward_from_chat?: unknown;
}

interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface BotUpdate {
  update_id?: number;
  message?: TgMessage;
  /**
   * Present in the payload but deliberately not dispatched: every message that
   * can arrive edited was already handled when it was first sent, so acting on
   * an edit of "/add milk" would create the task a second time.
   */
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** The user columns every handler needs. Kept narrow so the select stays cheap. */
type BotUser = Pick<
  UserRow,
  | "id"
  | "telegram_id"
  | "first_name"
  | "timezone"
  | "reminder_enabled"
  | "reminder_kinds"
  | "quiet_hours_start"
  | "quiet_hours_end"
>;

const USER_COLUMNS =
  "id, telegram_id, first_name, timezone, reminder_enabled, reminder_kinds, quiet_hours_start, quiet_hours_end";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The reminder kinds a user can toggle; `task` is per-task and not a digest. */
const TOGGLEABLE_KINDS = ["morning", "nudge", "evening", "weekly"] as const;
type ToggleableKind = (typeof TOGGLEABLE_KINDS)[number];

function isToggleableKind(value: string): value is ToggleableKind {
  return (TOGGLEABLE_KINDS as readonly string[]).includes(value);
}

/**
 * A Date whose *local* getters report the wall clock in `tz`.
 *
 * `parseTaskInput` resolves "tomorrow", "Friday" and a bare "9am" against
 * `todayLocal(now)`. On the server `now` is UTC, so a user in UTC+13 typing
 * "tomorrow" at 00:30 local would get the day that is already today for them.
 * Re-reading the zoned wall clock as a local Date keeps /add aligned with the
 * calendar the user is looking at.
 *
 * `hourCycle: "h23"`, not `hour12: false`: some ICU builds report midnight as
 * hour 24 with the latter, which `new Date(y, m, d, 24)` then rolls into the
 * *next* day.
 */
function nowInTimezone(tz: string, now: Date = new Date()): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    return new Date(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
  } catch {
    return now;
  }
}

/** A short local date for the /today heading, e.g. "Mon, 30 Sep". */
function formatDate(date: string, langCode: string | undefined): string {
  const locale =
    langCode === "ru" || langCode === "uk" || langCode === "be"
      ? "ru-RU"
      : "en-GB";
  try {
    return parseDateString(date).toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    // No ICU data for the locale, or a malformed date: the raw ISO day is a
    // worse heading but never a broken one.
    return date;
  }
}

/** `/add@MyBot pay rent` → { command: "add", args: "pay rent" } */
function parseCommand(
  text: string
): { command: string; args: string } | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

function isForwarded(msg: TgMessage): boolean {
  return Boolean(msg.forward_origin ?? msg.forward_from ?? msg.forward_from_chat);
}

/**
 * Guarantees exactly one `answerCallbackQuery` per callback.
 *
 * Telegram keeps a spinner on the button until the callback is answered, so
 * every path — including a thrown DB error — has to answer. Handlers call
 * `with(text)` for the happy path; the `finally` in `handleCallback` covers
 * everything else with a silent answer.
 */
function makeAnswerer(id: string) {
  let answered = false;
  return {
    async with(text?: string) {
      if (answered) return;
      answered = true;
      try {
        await answerCallbackQuery(id, text ? { text } : undefined);
      } catch (e) {
        // A query older than ~15s cannot be answered any more; that is not
        // worth failing the rest of the handler for.
        console.error("answerCallbackQuery failed:", e);
      }
    },
  };
}

// ── Users ──

/**
 * Finds the user by telegram_id, creating the row when the bot was never
 * started from this chat, and stamps `last_active_at` on every interaction
 * (requirement: any interaction counts as activity).
 */
async function ensureUser(
  db: Db,
  from: TgUser | undefined,
  chatId: number | undefined
): Promise<BotUser | null> {
  if (!from) return null;

  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("users")
    .select(USER_COLUMNS)
    .eq("telegram_id", from.id)
    .maybeSingle();

  if (existing) {
    await db
      .from("users")
      .update({ last_active_at: now })
      .eq("telegram_id", from.id);
    return existing;
  }

  const { data: created } = await db
    .from("users")
    .upsert(
      {
        telegram_id: from.id,
        first_name: from.first_name ?? "",
        username: from.username ?? null,
        chat_id: chatId ?? null,
        language_code: from.language_code ?? "en",
        last_active_at: now,
      },
      { onConflict: "telegram_id" }
    )
    .select(USER_COLUMNS)
    .single();

  return created ?? null;
}

// ── Settings panel ──

function settingsText(t: BotTranslations, user: BotUser): string {
  const start = toTimeString(user.quiet_hours_start);
  const end = toTimeString(user.quiet_hours_end);
  // `isQuietHour` treats start === end as "no quiet hours", so an equal pair is
  // the disabled state and a "22:00–22:00" range would read as a real window.
  const window = user.quiet_hours_start === user.quiet_hours_end ? "—" : `${start}–${end}`;
  return [
    t.botReminderSettings,
    "",
    `${t.quietHoursLabel}: ${window}`,
    t.quietHoursHint,
  ].join("\n");
}

function settingsKeyboard(t: BotTranslations, user: BotUser) {
  const kinds = reminderKinds(user);
  const on = user.reminder_enabled;
  // A tick on the button that is already in force, so the panel doubles as the
  // on/off readout; the kind rows show the jsonb flag itself rather than
  // isKindEnabled(), so kinds can be pre-set while the master switch is off.
  const mark = (enabled: boolean) => (enabled ? "✅" : "⬜");

  return {
    inline_keyboard: [
      [
        {
          text: `${on ? "✅ " : ""}${t.botEnableReminders}`,
          callback_data: "reminder_on",
        },
        {
          text: `${on ? "" : "✅ "}${t.botDisableReminders}`,
          callback_data: "reminder_off",
        },
      ],
      ...TOGGLEABLE_KINDS.map((kind) => [
        {
          text: `${mark(kinds[kind] !== false)} ${kindLabel(t, kind)}`,
          callback_data: `toggle:${kind}`,
        },
      ]),
    ],
  };
}

function kindLabel(t: BotTranslations, kind: ToggleableKind): string {
  switch (kind) {
    case "morning":
      return t.morningPlan;
    case "nudge":
      return t.middayNudge;
    case "evening":
      return t.eveningReview;
    case "weekly":
      return t.weeklyReportLabel;
  }
}

/**
 * Rewrites the settings panel in place after a toggle.
 *
 * Guarded on the message actually being the panel: `reminder_off` can also be
 * attached to a reminder the engine sent, and rewriting that would replace the
 * habit the user was being nudged about with the settings screen.
 */
async function refreshSettings(
  cq: TgCallbackQuery,
  user: BotUser
): Promise<void> {
  const message = cq.message;
  const t = botT(cq.from.language_code);
  if (!message?.text?.startsWith(t.botReminderSettings)) return;
  try {
    await editMessageText(
      message.chat.id,
      message.message_id,
      settingsText(t, user),
      { replyMarkup: settingsKeyboard(t, user) }
    );
  } catch (e) {
    // "message is not modified" when nothing changed, or a message too old to
    // edit. The toggle itself already succeeded, so this is cosmetic.
    console.error("settings refresh failed:", e);
  }
}

// ── Commands ──

async function cmdHelp(msg: TgMessage): Promise<void> {
  const t = botT(msg.from?.language_code);
  await sendMessage(msg.chat.id, t.botHelp);
}

async function cmdAdd(
  db: Db,
  msg: TgMessage,
  user: BotUser,
  args: string
): Promise<void> {
  const t = botT(msg.from?.language_code);
  const chatId = msg.chat.id;

  if (!args) {
    await sendMessage(chatId, t.botAddUsage);
    return;
  }

  const parsed = parseTaskInput(args, nowInTimezone(user.timezone || "UTC"));
  const title = parsed.title.slice(0, 200);

  const { data: todo, error } = await db
    .from("todos")
    .insert({
      user_id: user.id,
      title,
      due_date: parsed.dueDate ?? null,
      due_time: parsed.dueTime ?? null,
      // Left undefined when the text had no !priority, so the column default
      // applies rather than the bot inventing one.
      priority: parsed.priority,
    })
    .select("id")
    .single();

  if (error || !todo) {
    console.error("bot /add insert failed:", error?.message);
    return;
  }

  await linkTags(db, user.id, todo.id, parsed.tags ?? []);

  await sendMessage(chatId, fill(t.botAdded, { title: esc(title) }));
}

/**
 * Resolves `#tags` from parsed text to rows and links them to the todo.
 *
 * `tags` is documented as unique on (user_id, name), but this resolves by
 * select-then-insert rather than an upsert on those columns: the constraint
 * lives in the Supabase schema, which is not in this repo, so a wrong guess
 * here would fail the whole /add instead of just skipping a tag.
 */
async function linkTags(
  db: Db,
  userId: string,
  todoId: string,
  rawNames: string[]
): Promise<void> {
  const names = [...new Set(rawNames.map(normalizeTagName).filter(Boolean))];
  if (names.length === 0) return;

  const { data: existing } = await db
    .from("tags")
    .select("id, name")
    .eq("user_id", userId)
    .in("name", names);

  const idByName = new Map(
    (existing ?? []).map((tag) => [tag.name, tag.id] as const)
  );

  const missing = names.filter((name) => !idByName.has(name));
  if (missing.length > 0) {
    const { data: created } = await db
      .from("tags")
      .insert(missing.map((name) => ({ user_id: userId, name })))
      .select("id, name");
    for (const tag of created ?? []) idByName.set(tag.name, tag.id);
  }

  const links = names
    .map((name) => idByName.get(name))
    .filter((id): id is string => Boolean(id))
    .map((tag_id) => ({ todo_id: todoId, tag_id }));

  if (links.length > 0) {
    const { error } = await db.from("todo_tags").insert(links);
    if (error) console.error("bot tag link failed:", error.message);
  }
}

async function cmdToday(db: Db, msg: TgMessage, user: BotUser): Promise<void> {
  const t = botT(msg.from?.language_code);
  const date = dateInTimezone(user.timezone || "UTC");
  const chatId = msg.chat.id;

  // Same rule the Mini App's day view applies: `completed` comes from the day's
  // check-in row, and a habit with no row at all is pending (see the
  // `checkin?.completed ?? false` fold in /api/day). Two queries rather than an
  // embedded `checkins!left(...)`, because the generated types declare no
  // Relationships and an untyped embed is not worth the inference risk here.
  const [{ data: habits }, { data: checkins }] = await Promise.all([
    db
      .from("habits")
      .select("id, name, icon")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    db
      .from("checkins")
      .select("habit_id, completed")
      .eq("user_id", user.id)
      .eq("date", date),
  ]);

  const doneHabits = new Set(
    (checkins ?? []).filter((c) => c.completed).map((c) => c.habit_id)
  );
  const pendingHabits = (habits ?? []).filter((h) => !doneHabits.has(h.id));

  // Due today or overdue, which is what makes a chat digest worth reading.
  // Deliberately narrower than /api/day's list, which also carries every open
  // task with no due date: on a screen that scrolls that is fine, in a message
  // it would bury the day's actual work under an undated backlog. Subtasks are
  // excluded too — they are steps of a parent task, and the parent already
  // speaks for them.
  const { data: tasks } = await db
    .from("todos")
    .select("id, title, due_date, due_time")
    .eq("user_id", user.id)
    .eq("is_completed", false)
    .is("parent_id", null)
    .not("due_date", "is", null)
    .lte("due_date", date)
    .order("due_date", { ascending: true })
    .limit(20);

  const lines: string[] = [];
  if (pendingHabits.length > 0) {
    lines.push(`<b>${esc(t.habitsSection)}</b>`);
    for (const habit of pendingHabits) {
      lines.push(`• ${esc(habit.icon)} ${esc(habit.name)}`);
    }
  }
  if (tasks && tasks.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`<b>${esc(t.tasksSection)}</b>`);
    for (const todo of tasks) {
      const badge = todo.due_date === date ? t.dueToday : t.overdue;
      const time = todo.due_time ? ` ${todo.due_time}` : "";
      lines.push(`• ${esc(todo.title)} — ${esc(badge)}${time}`);
    }
  }

  if (lines.length === 0) {
    await sendMessage(chatId, t.botNothingToday);
    return;
  }

  const heading = fill(t.botTodayTitle, {
    date: formatDate(date, msg.from?.language_code),
  });
  await sendMessage(chatId, `${heading}\n\n${lines.join("\n")}`);
}

async function cmdStats(db: Db, msg: TgMessage, user: BotUser): Promise<void> {
  const t = botT(msg.from?.language_code);

  const { data: streaks } = await db
    .from("habit_streaks")
    .select("current_streak, total_completions")
    .eq("user_id", user.id);

  const rows = streaks ?? [];
  const total = rows.reduce((sum, s) => sum + (s.total_completions ?? 0), 0);

  if (rows.length === 0 || total === 0) {
    await sendMessage(msg.chat.id, t.noStreaksYet);
    return;
  }

  // There is no longest_streak column: the best streak is the highest
  // current_streak across the user's habits right now.
  const best = rows.reduce((max, s) => Math.max(max, s.current_streak ?? 0), 0);

  await sendMessage(
    msg.chat.id,
    [fill(t.botStreakLine, { count: best }), `${total} ${t.totalCheckins}`].join(
      "\n"
    )
  );
}

async function cmdSettings(msg: TgMessage, user: BotUser): Promise<void> {
  const t = botT(msg.from?.language_code);
  await sendMessage(msg.chat.id, settingsText(t, user), {
    replyMarkup: settingsKeyboard(t, user),
  });
}

// ── Forwarded messages ──

/**
 * A forwarded message with no command is a task the user wants to keep. The
 * text is stored verbatim (first 200 chars, the same cap TodoSchema enforces)
 * rather than run through parseTaskInput: a forwarded paragraph is prose, and
 * parsing would strip words that look like dates out of the middle of it.
 */
async function saveForwarded(db: Db, msg: TgMessage): Promise<string> {
  const source = (msg.text ?? msg.caption ?? "").trim();
  if (!source) return "ignored";

  const user = await ensureUser(db, msg.from, msg.chat.id);
  if (!user) return "ignored";

  const t = botT(msg.from?.language_code);
  const { error } = await db
    .from("todos")
    .insert({ user_id: user.id, title: source.slice(0, 200) });

  if (error) {
    console.error("bot forwarded insert failed:", error.message);
    return "ignored";
  }

  await sendMessage(msg.chat.id, t.botForwardedSaved);
  return "forwarded";
}

// ── Callback queries ──

/**
 * Marks one line of a reminder as done by appending ✅.
 *
 * The reminder engine owns the message layout and this module never sees it, so
 * rather than rebuild the message the line carrying the habit or task name is
 * found and ticked, leaving the rest for the still-open items in the same list.
 * The message text arrives exactly as it was sent, so the escaped name matches.
 */
function markLineDone(text: string, escapedName: string): string {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.includes(escapedName));
  if (index === -1) return `${text} ✅`;
  // Double taps are possible before the edit lands in the chat.
  if (lines[index].endsWith(" ✅")) return text;
  lines[index] = `${lines[index]} ✅`;
  return lines.join("\n");
}

/**
 * Rewrites the reminder message in place, keeping the keyboard in step.
 *
 * The edit always re-sends `reply_markup` explicitly: Bot API reads an omitted
 * reply_markup as "remove the keyboard", which would take the controls off the
 * rows still waiting to be done in the same list.
 *
 * `"dropMoodRow"` is for the one-shot mood question — it removes only the row
 * of `mood:` buttons, so the "Open HabitFlow" button underneath survives. An
 * empty result is the documented way to clear an inline keyboard entirely.
 */
async function editReminderMessage(
  cq: TgCallbackQuery,
  text: string,
  keyboard: "keep" | "dropMoodRow"
): Promise<void> {
  const message = cq.message;
  if (!message) return;

  const current = message.reply_markup?.inline_keyboard ?? [];
  const next =
    keyboard === "keep"
      ? current
      : current.filter(
          (row) => !row.some((b) => b.callback_data?.startsWith("mood:"))
        );

  try {
    await editMessageText(message.chat.id, message.message_id, text, {
      replyMarkup: { inline_keyboard: next },
    });
  } catch (e) {
    console.error("reminder edit failed:", e);
  }
}

/** Returns false when the mood could not be recorded at all. */
async function writeMood(
  db: Db,
  user: BotUser,
  mood: number,
  date: string
): Promise<boolean> {
  // Mood is a property of the user's day, but `checkins` has one row per habit
  // per day (unique on (habit_id, date)) with a NOT NULL habit_id, so there is
  // no row that can hold a day-level value on its own. Writing it to *every*
  // row for that day is the shape the Mini App already produces — its bulk save
  // posts one row per habit, each carrying the same mood — and it keeps the
  // stats endpoint's "any row with a mood is a mood reading" aggregation honest.
  const { data: updated, error } = await db
    .from("checkins")
    .update({ mood })
    .eq("user_id", user.id)
    .eq("date", date)
    .select("id");

  if (error) {
    console.error("bot mood update failed:", error.message);
    return false;
  }
  if (updated && updated.length > 0) return true;

  // Nothing checked in yet today (a mood prompt can arrive before any habit).
  // Seed the mood on the first active habit with completed=false.
  //
  // The alternative — dropping the mood when the day has no rows — would lose
  // it exactly on the days it matters most (nothing done yet), while the user
  // still sees "Mood logged". The seeded row is not a novel shape: the Mini
  // App's bulk save writes one row per habit with completed:false and the mood
  // on it whenever a habit was left undone, so nothing downstream can be
  // surprised by this. It also stays out of the way of completion state — the
  // Today view derives "done" from `completed`, so the habit still reads as
  // pending, and the day's later real check-in is an upsert onto this same
  // (habit_id, date) row that preserves the mood, because a plain toggle sends
  // no mood field.
  const { data: habit } = await db
    .from("habits")
    .select("id")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!habit) return false;

  // DO NOTHING, not DO UPDATE: this is a seed for a day with no check-ins, and
  // the row it might collide with can belong to an accountability partner.
  // A plain upsert would resolve the conflict by rewriting that row's user_id
  // to this user and stamping a mood onto their completion.
  const { error: seedError } = await db.from("checkins").upsert(
    { user_id: user.id, habit_id: habit.id, date, completed: false, mood },
    { onConflict: "habit_id, date", ignoreDuplicates: true }
  );
  if (seedError) {
    console.error("bot mood seed failed:", seedError.message);
    return false;
  }
  return true;
}

/**
 * Resolves a habit id from callback_data against the user's own habits, and
 * writes the check-in. Returns null when the id is malformed or is not theirs,
 * so a stale or forged button cannot write onto somebody else's habit.
 */
async function writeHabitCheckin(
  db: Db,
  user: BotUser,
  habitId: string,
  date: string,
  completed: boolean
): Promise<string | null> {
  if (!UUID_RE.test(habitId) || !DATE_RE.test(date)) return null;

  const { data: habit } = await db
    .from("habits")
    .select("id, name")
    .eq("id", habitId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!habit) return null;

  // checkins is unique on (habit_id, date), so a shared habit has ONE row per
  // day, and it may be the partner's. A plain upsert resolves that conflict
  // with an UPDATE, which would reassign the row's user_id to whoever tapped
  // and clobber their completion — or, on an Undo tap, erase it outright.
  //
  // ignoreDuplicates is not the fix here (unlike the seed above): this path
  // must still update the caller's OWN row so Undo can clear it. So read the
  // existing row first and leave a partner's day alone — it already counts as
  // completed for both of them.
  const { data: existing, error: readError } = await db
    .from("checkins")
    .select("user_id")
    .eq("habit_id", habit.id)
    .eq("date", date)
    .maybeSingle();

  if (readError) {
    console.error("bot checkin read failed:", readError.message);
    return null;
  }

  if (existing && existing.user_id !== user.id) return habit.name;

  const { error } = await db
    .from("checkins")
    .upsert(
      { user_id: user.id, habit_id: habit.id, date, completed },
      { onConflict: "habit_id, date" }
    );

  if (error) {
    console.error("bot checkin upsert failed:", error.message);
    return null;
  }
  return habit.name;
}

/** Completes a todo. Returns its title so the caller can tick its line. */
async function writeTodoDone(
  db: Db,
  user: BotUser,
  todoId: string
): Promise<string | null> {
  if (!UUID_RE.test(todoId)) return null;

  const { data: todo } = await db
    .from("todos")
    .select("id, title")
    .eq("id", todoId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!todo) return null;

  const { error } = await db
    .from("todos")
    .update({ is_completed: true, completed_at: new Date().toISOString() })
    .eq("id", todo.id)
    .eq("user_id", user.id);

  if (error) {
    console.error("bot todo complete failed:", error.message);
    return null;
  }
  return todo.title;
}

/**
 * Every branch follows the same order — do the work, answer the callback,
 * then edit the message — so the toast the user sees is never a lie: a callback
 * whose work failed is answered silently by the `finally` instead of reporting
 * success.
 */
async function handleCallback(
  db: Db,
  cq: TgCallbackQuery
): Promise<string> {
  const answer = makeAnswerer(cq.id);
  try {
    const [verb, ...rest] = (cq.data ?? "").split(":");

    // Every branch needs the user row: for its id, for its language, or just
    // for the last_active_at stamp this interaction earns it.
    const user = await ensureUser(db, cq.from, cq.message?.chat.id);
    if (!user) return "callback:unknown";

    const t = botT(cq.from.language_code);
    const messageText = cq.message?.text;
    const tick = async (handleKey: string, name: string) => {
      if (messageText) {
        // Keep the buttons: a reminder can list several habits, and the rows
        // still to be done must stay tappable.
        await editReminderMessage(cq, markLineDone(messageText, esc(name)), "keep");
      }
      return handleKey;
    };

    switch (verb) {
      case "mood": {
        const value = rest[0] ?? "";
        const date = rest[1] ?? "";
        if (
          (value !== "1" && value !== "2" && value !== "3") ||
          !DATE_RE.test(date)
        )
          return "callback:mood-invalid";

        const written = await writeMood(db, user, Number(value), date);
        if (!written) return "callback:mood-failed";

        await answer.with(t.botMoodLogged);
        // The mood question is one-shot and applies to the whole day, so its
        // buttons come off; the other callbacks leave theirs in place.
        await editReminderMessage(cq, messageText ?? "", "dropMoodRow");
        return "callback:mood";
      }

      case "done":
      case "skip": {
        const completed = verb === "done";
        const name = await writeHabitCheckin(
          db,
          user,
          rest[0] ?? "",
          rest[1] ?? "",
          completed
        );
        if (!name) return `callback:${verb}-invalid`;

        await answer.with(completed ? t.botDone : t.botSkipped);
        return await tick(`callback:${verb}`, name);
      }

      case "later": {
        // Snooze is deliberately a no-op beyond the acknowledgement: nothing is
        // rescheduled, the habit simply is not marked done.
        await answer.with(t.botSnoozed);
        return "callback:later";
      }

      case "todo_done": {
        const title = await writeTodoDone(db, user, rest[0] ?? "");
        if (!title) return "callback:todo_done-invalid";

        await answer.with(t.botDone);
        return await tick("callback:todo_done", title);
      }

      case "todo_later": {
        await answer.with(t.botSnoozed);
        return "callback:todo_later";
      }

      case "toggle": {
        const kind = rest[0] ?? "";
        if (!isToggleableKind(kind)) return "callback:unknown";

        // Read-modify-write of the jsonb: the other three kinds must survive
        // one toggle, and Postgres cannot update a single nested key.
        const kinds = reminderKinds(user);
        const next = { ...kinds, [kind]: kinds[kind] === false };

        const { error } = await db
          .from("users")
          .update({ reminder_kinds: next })
          .eq("telegram_id", user.telegram_id);
        if (error) {
          console.error("bot toggle failed:", error.message);
          return "callback:toggle-failed";
        }

        await answer.with();
        await refreshSettings(cq, { ...user, reminder_kinds: next });
        return `callback:toggle:${kind}`;
      }

      case "reminder_on":
      case "reminder_off": {
        const enabled = verb === "reminder_on";
        const { error } = await db
          .from("users")
          .update({ reminder_enabled: enabled })
          .eq("telegram_id", user.telegram_id);
        if (error) {
          console.error("bot reminder switch failed:", error.message);
          return `callback:${verb}-failed`;
        }

        await answer.with();
        await refreshSettings(cq, { ...user, reminder_enabled: enabled });
        return `callback:${verb}`;
      }

      default:
        // Unknown callback_data: still answered, silently, so the button never
        // spins forever when a newer reminder engine emits a verb this build
        // does not know yet.
        await answer.with();
        return "callback:unknown";
    }
  } finally {
    // Covers every early return and any throw from the branches above.
    await answer.with();
  }
}

// ── Entry point ──

async function handleMessage(db: Db, msg: TgMessage): Promise<string> {
  const command = parseCommand(msg.text ?? "");

  if (isForwarded(msg) && !command) return await saveForwarded(db, msg);
  if (!command) return "ignored";

  // /start is handled in the route because it sends the welcome media; a bare
  // "/start <payload>" would fall through to here, and re-sending the welcome
  // is the route's job, not something to duplicate with a second code path.
  if (command.command === "start") return "ignored";

  const user = await ensureUser(db, msg.from, msg.chat.id);
  if (!user) return "ignored";

  switch (command.command) {
    case "help":
      await cmdHelp(msg);
      return "help";
    case "add":
      await cmdAdd(db, msg, user, command.args);
      return "add";
    case "today":
      await cmdToday(db, msg, user);
      return "today";
    case "stats":
      await cmdStats(db, msg, user);
      return "stats";
    case "settings":
      await cmdSettings(msg, user);
      return "settings";
    default: {
      // An unrecognised command (usually a typo) gets the command list rather
      // than silence — botHelp is the key that exists for exactly this.
      await cmdHelp(msg);
      return "unknown-command";
    }
  }
}

/**
 * Dispatches one Telegram update. Always resolves to an informative
 * `handled` value so the webhook response says what happened.
 */
export async function handleBotUpdate(
  update: BotUpdate,
  db: Db = serverClient()
): Promise<{ ok: true; handled: string }> {
  if (update.callback_query) {
    return { ok: true, handled: await handleCallback(db, update.callback_query) };
  }

  // Only `message`, never `edited_message`: see the note on BotUpdate.
  const msg = update.message;
  if (msg) return { ok: true, handled: await handleMessage(db, msg) };

  return { ok: true, handled: "ignored" };
}
