import { z } from "zod";
import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient, serverClient } from "@/lib/supabase";
import { addDays, dateInTimezone } from "@/lib/dates";

/**
 * Streak status and streak protection.
 *
 * "Today" is always the *user's* calendar day (users.timezone), never the
 * server's: a freeze written for the wrong day would protect nothing.
 */

const FreezeSchema = z.object({
  action: z.literal("freeze"),
  habit_id: z.string().uuid(),
});

export const GET = withAuth(async (req, ctx: AuthenticatedContext) => {
  const uid = ctx.user.internal_uuid;
  const sb = authenticatedClient(ctx.user.supabase_token);
  const today = dateInTimezone(ctx.profile.timezone || "UTC");

  const [habitsRes, streaksRes, doneRes] = await Promise.all([
    sb
      .from("habits")
      .select("id, name, icon")
      // Only our own habits. A habit shared with us is listed under the
      // partner's account, and POST below refuses to freeze it, so offering it
      // here would be an at-risk row the user can never act on.
      .eq("user_id", uid)
      .is("archived_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    sb.from("habit_streaks").select("*").eq("user_id", uid),
    sb
      .from("checkins")
      .select("habit_id")
      .eq("user_id", uid)
      .eq("date", today)
      .eq("completed", true),
  ]);

  if (habitsRes.error || streaksRes.error || doneRes.error)
    return Response.json({ error: "QUERY_FAILED" }, { status: 500 });

  const streaks = new Map(
    (streaksRes.data ?? []).map((row) => [row.habit_id, row])
  );
  const doneToday = new Set((doneRes.data ?? []).map((row) => row.habit_id));

  const month = today.slice(0, 7); // YYYY-MM
  // A run is only "current" if it reaches today or yesterday. habit_streaks is
  // recomputed by a trigger on check-in writes, so someone who simply stopped
  // checking in keeps their last value forever — the row goes stale precisely
  // for the users this endpoint is about. Re-check it here rather than trusting
  // the stored number, or we would offer a grace day to save an already-dead
  // streak and spend the month's only one doing it.
  const yesterday = addDays(today, -1);

  return Response.json({
    habits: (habitsRes.data ?? []).map((habit) => {
      const streak = streaks.get(habit.id);
      const lastCompleted = streak?.last_completed ?? null;
      const live = lastCompleted !== null && lastCompleted >= yesterday;
      const current = live ? (streak?.current_streak ?? 0) : 0;
      return {
        habit_id: habit.id,
        name: habit.name,
        icon: habit.icon,
        current_streak: current,
        total_completions: streak?.total_completions ?? 0,
        last_completed: streak?.last_completed ?? null,
        // A live streak with nothing logged today is the one the warning is for.
        atRisk: current > 0 && !doneToday.has(habit.id),
      };
    }),
    // The grace day is one per calendar month, stamped by freeze_month.
    grace_day_available: ctx.profile.freeze_month !== month,
    freeze_month: ctx.profile.freeze_month,
  });
});

export const POST = withAuth(async (req, ctx: AuthenticatedContext) => {
  const uid = ctx.user.internal_uuid;
  const body = await req.json().catch(() => ({}));
  const parsed = FreezeSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const habitId = parsed.data.habit_id;
  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data: habit, error: habitError } = await sb
    .from("habits")
    .select("id, name")
    .eq("id", habitId)
    .eq("user_id", uid)
    .maybeSingle();

  if (habitError)
    return Response.json({ error: habitError.message }, { status: 500 });
  if (!habit) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const today = dateInTimezone(ctx.profile.timezone || "UTC");
  const yesterday = addDays(today, -1);
  const month = today.slice(0, 7);

  if (ctx.profile.freeze_month === month)
    return Response.json({ error: "graceDayNone" }, { status: 400 });

  // Read the day being protected *before* spending anything. The grace day is
  // only worth a month's supply when the day it repairs is actually missing or
  // unfinished — and this endpoint is easy to reach in a state where it is not:
  // atRisk is reported for anyone with a live streak and nothing logged *today*,
  // which includes a user who finished everything yesterday and is simply
  // opening the app in the morning. Claiming the month there would burn it for
  // nothing and report frozen: true while nothing changed.
  //
  // Not scoped by user_id: checkins is unique on (habit_id, date), so a partner
  // checking in on a shared habit holds that day's slot, and we need to see it
  // to know we cannot and need not write.
  const { data: existing, error: existingError } = await sb
    .from("checkins")
    .select("id, user_id, completed")
    .eq("habit_id", habitId)
    .eq("date", yesterday)
    .maybeSingle();

  if (existingError)
    return Response.json({ error: existingError.message }, { status: 500 });

  const mine = existing && existing.user_id === uid ? existing : null;

  if (existing && !mine)
    // The partner already has that day handled; the day is not ours to repair.
    return Response.json({ frozen: false, reason: "covered_by_partner" });
  if (mine?.completed)
    return Response.json({ frozen: false, reason: "already_complete" });

  // Claim the month with a conditional update instead of a read-then-write:
  // two taps in flight on different habits must not both spend one grace day.
  // (`.or` covers freeze_month being NULL — NULL never satisfies `neq`.)
  const admin = serverClient();
  const { data: claimed, error: claimError } = await admin
    .from("users")
    .update({ freeze_month: month })
    .eq("id", uid)
    .or(`freeze_month.is.null,freeze_month.neq.${month}`)
    .select("id");

  if (claimError)
    return Response.json({ error: claimError.message }, { status: 500 });
  if (!claimed || claimed.length === 0)
    return Response.json({ error: "graceDayNone" }, { status: 400 });

  // The freeze *is* a completed check-in for yesterday: the streak keeps
  // counting and the missed day stops looking like a miss.
  let writeError: string | null = null;
  // True when another device wrote the row between our read and our write: the
  // day ended up covered, so the grace day goes back.
  let raced = false;

  if (mine) {
    // Only the flag: an update keeps any mood or note already on that day.
    const { error } = await sb
      .from("checkins")
      .update({ completed: true })
      .eq("id", mine.id);
    writeError = error?.message ?? null;
  } else {
    // ON CONFLICT DO NOTHING, never a bare insert: the slot is unique on
    // (habit_id, date), so a row we cannot see would otherwise fail the request
    // with 23505 after the grace day had already been spent.
    const { data, error } = await sb
      .from("checkins")
      .upsert(
        { user_id: uid, habit_id: habitId, date: yesterday, completed: true },
        { onConflict: "habit_id, date", ignoreDuplicates: true }
      )
      .select("habit_id");
    writeError = error?.message ?? null;
    raced = !error && (data?.length ?? 0) === 0;
  }

  if (writeError || raced) {
    // Hand the grace day back rather than burn it on a write that failed or
    // became unnecessary. Guarded by .eq("freeze_month", month) so we only undo
    // our own claim — if a newer value is already there, it is not ours to drop.
    const { error: restoreError } = await admin
      .from("users")
      .update({ freeze_month: ctx.profile.freeze_month })
      .eq("id", uid)
      .eq("freeze_month", month);
    if (restoreError) console.error("freeze rollback failed:", restoreError);
    if (raced) return Response.json({ frozen: false, reason: "already_complete" });
    return Response.json({ error: writeError }, { status: 500 });
  }

  return Response.json({
    frozen: true,
    habit_id: habitId,
    date: yesterday,
    freeze_month: month,
  });
});
