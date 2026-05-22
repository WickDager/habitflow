import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { TodoSchema } from "@/lib/schemas";

export const GET = withAuth(async (req, ctx) => {
  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data, error } = await sb
    .from("todos")
    .select("*")
    .order("created_at", { ascending: false });

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = TodoSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data, error } = await sb
    .from("todos")
    .insert({ user_id: ctx.user.internal_uuid, ...parsed.data })
    .select()
    .single();

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});
