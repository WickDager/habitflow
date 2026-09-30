import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { dateInTimezone } from "@/lib/dates";
import type {
  CheckinRow,
  HabitRow,
  HabitStreakRow,
  TodoRow,
} from "@/lib/database.types";

/**
 * My Day — one authenticated call for the whole merged daily view.
 *
 * The Today tab used to fetch habits only, so anything else it wanted to show
 * meant another round trip and another source of truth to keep in sync. This
 * route returns habits + tasks + overdue + focus together, so the screen
 * renders from a single response.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The day to build. The client sends its own local date — only the device
 * knows which calendar day the user is in. When it doesn't (bot, curl, cron),
 * fall back to the profile timezone, which withAuth refreshes from the
 * x-timezone header on every request.
 */
function resolveDate(value: unknown, ctx: AuthenticatedContext): string {
  return typeof value === "string" && DATE_RE.test(value)
    ? value
    : dateInTimezone(ctx.profile.timezone);
}

/**
 * priority desc (3 = high), then due_time ascending.
 *
 * Untimed tasks sort after timed ones: a task with a 09:00 badge belongs above
 * one with no badge at all. created_at is the final tie-break so the order is
 * stable between requests.
 */
function sortTodos(rows: TodoRow[]): TodoRow[] {
  return [...rows].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.due_time !== b.due_time) {
      if (!a.due_time) return 1;
      if (!b.due_time) return -1;
      return a.due_time < b.due_time ? -1 : 1;
    }
    if (a.created_at === b.created_at) return 0;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

export const GET = withAuth(async (req, ctx) => {
  const date = resolveDate(new URL(req.url).searchParams.get("date"), ctx);
  const userId = ctx.user.internal_uuid;
  const sb = authenticatedClient(ctx.user.supabase_token);

  // Every query is scoped by user_id as well as by RLS: the habit rows here
  // feed a single merged screen, and one missing policy would leak another
  // user's day into it.
  const [habitsRes, checkinsRes, streaksRes, todosRes, focusRes] =
    await Promise.all([
      sb
        .from("habits")
        .select("*")
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("sort_order", { ascending: true }),
      sb.from("checkins").select("*").eq("user_id", userId).eq("date", date),
      sb.from("habit_streaks").select("*").eq("user_id", userId),
      sb
        .from("todos")
        .select("*")
        .eq("user_id", userId)
        .eq("is_completed", false),
      sb
        .from("daily_focus")
        .select("habit_id")
        .eq("user_id", userId)
        .eq("date", date),
    ]);

  const failed = [habitsRes, checkinsRes, streaksRes, todosRes, focusRes].find(
    (r) => r.error
  );
  if (failed?.error)
    return Response.json({ error: failed.error.message }, { status: 500 });

  const habitRows = (habitsRes.data ?? []) as HabitRow[];
  const checkins = (checkinsRes.data ?? []) as CheckinRow[];
  const streaks = (streaksRes.data ?? []) as HabitStreakRow[];
  const openTodos = (todosRes.data ?? []) as TodoRow[];
  const focus = ((focusRes.data ?? []) as { habit_id: string }[]).map(
    (r) => r.habit_id
  );

  const checkinByHabit = new Map(checkins.map((c) => [c.habit_id, c]));
  const streakByHabit = new Map(streaks.map((s) => [s.habit_id, s]));

  const habits = habitRows
    .map((habit) => {
      const checkin = checkinByHabit.get(habit.id);
      const streak = streakByHabit.get(habit.id);
      return {
        ...habit,
        completed: checkin?.completed ?? false,
        mood: checkin?.mood ?? null,
        streak: streak?.current_streak ?? 0,
        total: streak?.total_completions ?? 0,
        focused: focus.includes(habit.id),
      };
    })
    // Focused habits first (in the order they were pinned), then sort_order.
    .sort((a, b) => {
      if (a.focused !== b.focused) return a.focused ? -1 : 1;
      if (a.focused && b.focused)
        return focus.indexOf(a.id) - focus.indexOf(b.id);
      return a.sort_order - b.sort_order;
    });

  // Overdue is a subset of tasks, not a separate list: the spec asks for
  // `due_date <= date OR NULL` in `tasks`, and `overdue` marks which of those
  // rows are late so the client can style and offer to roll them forward.
  const overdue = sortTodos(openTodos.filter((t) => t.due_date && t.due_date < date));
  const tasks = sortTodos(
    openTodos.filter((t) => !t.due_date || t.due_date <= date)
  );

  return Response.json({
    date,
    habits,
    tasks,
    overdue,
    focus,
    /** How many open tasks a rollover would move — the "Move all" affordance. */
    rollsOverdueCount: overdue.length,
  });
});

/**
 * POST /api/day — the one write this resource owns:
 *
 *   { "action": "rollover", "date"?: "YYYY-MM-DD", "ids"?: string[] }
 *
 * Moves every open, past-due task onto `date` and bumps rolled_over_count, so
 * a task that keeps slipping is visibly one the user keeps postponing.
 * `ids` narrows it to a single task, which is what the per-row "Move to today"
 * button sends; without it the whole overdue list moves (the "Move all"
 * affordance).
 */
export const POST = withAuth(async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    date?: unknown;
    ids?: unknown;
  };

  if (body.action !== "rollover")
    return Response.json({ error: "UNKNOWN_ACTION" }, { status: 400 });

  const date = resolveDate(body.date, ctx);
  const userId = ctx.user.internal_uuid;
  const sb = authenticatedClient(ctx.user.supabase_token);

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : null;
  if (ids && ids.length === 0)
    return Response.json({ error: "INVALID_IDS" }, { status: 400 });

  // due_date < date already excludes NULLs (NULL < date is NULL, not true),
  // and is_completed = false keeps done work where it is.
  let query = sb
    .from("todos")
    .select("*")
    .eq("user_id", userId)
    .eq("is_completed", false)
    .lt("due_date", date);
  if (ids) query = query.in("id", ids);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as TodoRow[];
  if (rows.length === 0)
    return Response.json({ date, moved: 0, failed: 0 });

  // rolled_over_count is per-row, and PostgREST has no increment expression,
  // so each task is updated with its own next value. N is small (only what
  // slipped), and parallel is fine — they are independent rows.
  const results = await Promise.all(
    rows.map((row) =>
      sb
        .from("todos")
        .update({
          due_date: date,
          rolled_over_count: (row.rolled_over_count ?? 0) + 1,
        })
        .eq("id", row.id)
        .eq("user_id", userId)
    )
  );

  const moved = results.filter((r) => !r.error).length;
  const failedCount = results.length - moved;
  if (moved === 0)
    return Response.json(
      { error: results[0]?.error?.message ?? "ROLLOVER_FAILED" },
      { status: 500 }
    );

  return Response.json({ date, moved, failed: failedCount });
});
