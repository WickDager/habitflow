import { withAuth } from "@/lib/withAuth";
import { serverClient } from "@/lib/supabase";
import { BulkCheckinSchema } from "@/lib/schemas";

export const GET = (req: Request) =>
  withAuth(req, async (req, user) => {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

    const sb = serverClient();
    const userRow = await sb
      .from("users")
      .select("id")
      .eq("telegram_id", user.id)
      .single();

    if (!userRow.data)
      return Response.json({ error: "USER_NOT_FOUND" }, { status: 404 });

    const { data, error } = await sb
      .from("habits")
      .select(
        `*,
        checkins!left(*, filter: date.eq.${date})`
      )
      .eq("user_id", userRow.data.id)
      .is("archived_at", null)
      .order("sort_order", { ascending: true });

    if (error)
      return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  });

export const POST = (req: Request) =>
  withAuth(req, async (req, user) => {
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

    const sb = serverClient();
    const userRow = await sb
      .from("users")
      .select("id")
      .eq("telegram_id", user.id)
      .single();

    if (!userRow.data)
      return Response.json({ error: "USER_NOT_FOUND" }, { status: 404 });

    const rows = parsed.data.checkins.map((c) => ({
      user_id: userRow.data.id,
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
