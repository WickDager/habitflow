import { z } from "zod";
import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { HabitSchema } from "@/lib/schemas";

type RouteParams = { params: Promise<{ id: string }> };

/** sort_order is how the list is reordered — see /api/habits GET. */
const HabitPatchSchema = HabitSchema.partial().extend({
  sort_order: z.number().int().min(0).optional(),
});

const NOT_FOUND = { error: "NOT_FOUND" };

export const PATCH = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const body = await req.json().catch(() => ({}));
  const parsed = HabitPatchSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  if (Object.keys(parsed.data).length === 0)
    return Response.json({ error: "EMPTY_PATCH" }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);

  // maybeSingle, not single: "no row matched" is a 404 — an id that is not ours
  // or no longer exists is a client mistake, not a server fault. Scoped by
  // user_id as well as by RLS, the way every other write in the app is: an id
  // belonging to someone else must not be updatable even if a policy widens.
  const { data, error } = await sb
    .from("habits")
    .update(parsed.data)
    .eq("id", id)
    .eq("user_id", ctx.user.internal_uuid)
    .select()
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json(NOT_FOUND, { status: 404 });

  return Response.json(data);
});

export const DELETE = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const sb = authenticatedClient(ctx.user.supabase_token);

  // Habits are archived, never dropped. Selecting the row back is what tells a
  // successful archive apart from an id that matched nothing.
  const { data, error } = await sb
    .from("habits")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", ctx.user.internal_uuid)
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return Response.json(NOT_FOUND, { status: 404 });

  return new Response(null, { status: 204 });
});
