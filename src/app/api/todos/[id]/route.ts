import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { TodoSchema } from "@/lib/schemas";

type RouteParams = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const body = await req.json();
  const parsed = TodoSchema.partial().safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data, error } = await sb
    .from("todos")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});

export const DELETE = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const sb = authenticatedClient(ctx.user.supabase_token);

  const { error } = await sb
    .from("todos")
    .delete()
    .eq("id", id);

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return new Response(null, { status: 204 });
});
