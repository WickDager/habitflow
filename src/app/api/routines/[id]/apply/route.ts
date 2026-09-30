import { z } from "zod";
import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import {
  addDays,
  dateInTimezone,
  parseDateString,
  toDateString,
} from "@/lib/dates";

type RouteParams = { params: Promise<{ id: string }> };

const ApplySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Check in every habit of a routine for one day.
 *
 * Deliberately not a plain upsert of whole rows: an upsert replaces the row, so
 * a habit the user had already logged a mood or note against would come back
 * with those fields nulled. We only touch what changes — insert the rows that
 * are missing, flip the ones that are false — and leave the rest as they were.
 *
 * checkins is unique on (habit_id, date), and a shared habit is checked in by
 * whoever gets there first, so the rows for a habit+day are not necessarily
 * ours. Inserts therefore go through ON CONFLICT DO NOTHING and the probe below
 * is not scoped by user_id: the goal is that applying a routine can never fail
 * on a unique constraint, and can never rewrite the partner's row.
 */
export const POST = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const body = await req.json().catch(() => ({}));
  const parsed = ApplySchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const uid = ctx.user.internal_uuid;
  const sb = authenticatedClient(ctx.user.supabase_token);

  // "Today" is the user's calendar day, not the server's.
  const tz = ctx.profile.timezone || "UTC";
  const today = dateInTimezone(tz);
  const yesterday = addDays(today, -1);
  const date = parsed.data.date ?? today;

  // The same window the bulk check-in route enforces. Without it a caller could
  // check a routine in for next January and feed the streak trigger days that
  // have not happened. The regex alone also accepts impossible days like
  // 2026-02-31, which parseDateString would silently roll into March.
  if (date !== today && date !== yesterday)
    return Response.json({ error: "INVALID_DATE" }, { status: 400 });
  if (toDateString(parseDateString(date)) !== date)
    return Response.json({ error: "INVALID_DATE" }, { status: 400 });

  const { data: routine, error: routineError } = await sb
    .from("routines")
    .select("*")
    .eq("id", id)
    .eq("user_id", uid)
    .maybeSingle();

  if (routineError)
    return Response.json({ error: routineError.message }, { status: 500 });
  if (!routine) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Weekday of the *requested* date. parseDateString builds a local-noon Date,
  // so getDay() is that calendar day's weekday whatever timezone we run in.
  const weekday = parseDateString(date).getDay();
  if (routine.days.length > 0 && !routine.days.includes(weekday))
    return Response.json({ applied: 0, scheduled: false });

  const { data: items, error: itemsError } = await sb
    .from("routine_items")
    .select("habit_id")
    .eq("routine_id", id)
    .order("sort_order", { ascending: true });

  if (itemsError)
    return Response.json({ error: itemsError.message }, { status: 500 });

  const habitIds = (items ?? []).map((item) => item.habit_id);
  if (habitIds.length === 0)
    return Response.json({ applied: 0, scheduled: true });

  // Archived habits are invisible in the day view, so checking them in would
  // silently inflate the count and the stats.
  const { data: habits } = await sb
    .from("habits")
    .select("id, archived_at")
    .in("id", habitIds);

  const active = new Set(
    (habits ?? []).filter((h) => h.archived_at === null).map((h) => h.id)
  );
  const targets = habitIds.filter((habit_id) => active.has(habit_id));

  if (targets.length === 0)
    return Response.json({ applied: 0, scheduled: true });

  const { data: existing, error: existingError } = await sb
    .from("checkins")
    .select("habit_id, user_id, completed")
    .eq("date", date)
    .in("habit_id", targets);

  if (existingError)
    return Response.json({ error: existingError.message }, { status: 500 });

  const rows = existing ?? [];

  // Any row — ours or the partner's — already occupies that habit's slot for
  // the day, so there is nothing to insert.
  const covered = new Set(rows.map((row) => row.habit_id));
  // Only our own unfinished rows may be flipped. The partner's row is theirs.
  const toFlip = rows
    .filter((row) => row.user_id === uid && !row.completed)
    .map((row) => row.habit_id);
  const toInsert = targets.filter((habit_id) => !covered.has(habit_id));

  let inserted = 0;

  if (toInsert.length > 0) {
    // DO NOTHING rather than a plain insert: a row we cannot even see (a
    // partner's, if their check-ins are not visible to us) still holds the
    // unique key, and a bare insert would fail the whole batch with 23505.
    const { data, error } = await sb
      .from("checkins")
      .upsert(
        toInsert.map((habit_id) => ({
          user_id: uid,
          habit_id,
          date,
          completed: true,
        })),
        { onConflict: "habit_id, date", ignoreDuplicates: true }
      )
      .select("habit_id");

    if (error) return Response.json({ error: error.message }, { status: 500 });
    // Only the rows that were actually written come back.
    inserted = data?.length ?? 0;
  }

  if (toFlip.length > 0) {
    const { error } = await sb
      .from("checkins")
      .update({ completed: true })
      .eq("user_id", uid)
      .eq("date", date)
      .in("habit_id", toFlip);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  // Habits already checked in (by either partner) are not counted: nothing
  // changed for them, and a stale "4 habits checked in" would overstate the tap.
  return Response.json({
    applied: inserted + toFlip.length,
    scheduled: true,
  });
});
