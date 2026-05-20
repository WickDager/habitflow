import { withAuth } from "@/lib/withAuth";
import { serverClient } from "@/lib/supabase";
import { HabitSchema } from "@/lib/schemas";

export const PATCH = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (req, user) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = HabitSchema.partial().safeParse(body);
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
      .update(parsed.data)
      .eq("id", id)
      .eq("user_id", userRow.data.id)
      .select()
      .single();

    if (error)
      return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  });

export const DELETE = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (req, user) => {
    const { id } = await params;
    const sb = serverClient();
    const userRow = await sb
      .from("users")
      .select("id")
      .eq("telegram_id", user.id)
      .single();

    if (!userRow.data)
      return Response.json({ error: "USER_NOT_FOUND" }, { status: 404 });

    const { error } = await sb
      .from("habits")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userRow.data.id);

    if (error)
      return Response.json({ error: error.message }, { status: 500 });
    return new Response(null, { status: 204 });
  });
