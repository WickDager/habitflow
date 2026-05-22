import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { BulkCheckinSchema } from "@/lib/schemas";

export const GET = withAuth(async (req, ctx) => {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

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

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

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
