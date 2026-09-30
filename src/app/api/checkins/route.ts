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

  const { data, error } = await sb
    .from("checkins")
    .upsert(rows, { onConflict: "habit_id, date" })
    .select();

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});
