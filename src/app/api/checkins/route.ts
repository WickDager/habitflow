import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { BulkCheckinSchema } from "@/lib/schemas";
import { addDays, dateInTimezone } from "@/lib/dates";

export const GET = withAuth(async (req, ctx) => {
  const url = new URL(req.url);
  // Default to the caller's local day, not UTC's — they differ for most of the
  // world for part of the day, and the client asks by its own local date.
  const date =
    url.searchParams.get("date") ??
    dateInTimezone(ctx.profile.timezone || "UTC");

  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data, error } = await sb
    .from("habits")
    .select(
      `*,checkins!left(*)`
    )
    .is("archived_at", null)
    .eq("checkins.date", date)
    .order("sort_order", { ascending: true });

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = BulkCheckinSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  // The window must be the *caller's* local today/yesterday, not UTC's. The
  // client sends dates from its own local calendar, so for users far enough
  // east (UTC+12 and beyond) a morning save carried tomorrow's UTC date and
  // was rejected as INVALID_DATE.
  const timezone = ctx.profile.timezone || "UTC";
  const today = dateInTimezone(timezone);
  const yesterday = addDays(today, -1);

  for (const c of parsed.data.checkins) {
    if (c.date !== today && c.date !== yesterday)
      return Response.json(
        { error: "INVALID_DATE" },
        { status: 400 }
      );
  }

  const sb = authenticatedClient(ctx.user.supabase_token);

  const rows = parsed.data.checkins.map((c) => ({
    user_id: ctx.user.internal_uuid,
    habit_id: c.habit_id,
    date: c.date,
    completed: c.completed,
    mood: c.mood,
    notes: c.notes,
  }));

  // A shared habit has ONE row per (habit_id, date) — checkins is unique on
  // those two columns — so when a partner already completed it today, the
  // upsert's ON CONFLICT arm targets THEIR row. The only UPDATE-permitting
  // policy is `auth.uid() = user_id`, so that either fails with 42501 or
  // silently reassigns the row's user_id to the caller (corrupting the
  // per-person counts in /api/shares).
  //
  // We cannot simply add ignoreDuplicates: ON CONFLICT DO NOTHING would also
  // stop a user UNchecking their own habit — the row would stay completed.
  // So drop only the rows that belong to someone else and upsert the rest,
  // which preserves the toggle for our own rows and leaves the partner's
  // completion standing (either of us completing it counts for the day).
  const foreignKeys = new Set<string>();
  const habitIds = [...new Set(rows.map((r) => r.habit_id))];
  const dates = [...new Set(rows.map((r) => r.date))];

  if (habitIds.length > 0) {
    const { data: theirs, error: readError } = await sb
      .from("checkins")
      .select("habit_id, date")
      .in("habit_id", habitIds)
      .in("date", dates)
      .neq("user_id", ctx.user.internal_uuid);

    if (readError)
      return Response.json({ error: readError.message }, { status: 500 });

    for (const row of theirs ?? []) {
      foreignKeys.add(`${row.habit_id}:${row.date}`);
    }
  }

  const writable = rows.filter((r) => !foreignKeys.has(`${r.habit_id}:${r.date}`));
  if (writable.length === 0) return Response.json([]);

  const { data, error } = await sb
    .from("checkins")
    .upsert(writable, { onConflict: "habit_id, date" })
    .select();

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});
