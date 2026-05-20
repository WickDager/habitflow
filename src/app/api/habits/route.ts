import { withAuth } from "@/lib/withAuth";
import { serverClient } from "@/lib/supabase";
import { HabitSchema } from "@/lib/schemas";

export const GET = (req: Request) =>
  withAuth(req, async (req, user) => {
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
      .select("*")
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
    const parsed = HabitSchema.safeParse(body);
    if (!parsed.success)
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });

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
      .insert({ user_id: userRow.data.id, ...parsed.data })
      .select()
      .single();

    if (error) {
      if (error.message.includes("HABIT_LIMIT_REACHED"))
        return Response.json({ error: "HABIT_LIMIT_REACHED" }, { status: 400 });
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json(data);
  });
