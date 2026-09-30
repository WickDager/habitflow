import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { HabitSchema } from "@/lib/schemas";

/**
 * Ordering note: every habit used to be inserted with sort_order 0, so the list
 * came back in whatever order the database felt like — and it could change
 * between requests. New habits now land at the end, and every list is ordered
 * by (sort_order, created_at) so a tie can never shuffle the UI.
 *
 * PATCH /api/habits/[id] accepts sort_order for reordering.
 */
const HabitInputSchema = HabitSchema.extend({
  sort_order: z.number().int().min(0).optional(),
});

export const GET = withAuth(async (req, ctx) => {
  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data, error } = await sb
    .from("habits")
    .select("*")
    // This endpoint is "my habits": the habits this user owns, which are also
    // the only ones a routine can contain or a partner can be invited to.
    // Habits shared *with* the user still show up in the day view, which reads
    // /api/checkins instead.
    .eq("user_id", ctx.user.internal_uuid)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const parsed = HabitInputSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);
  const { sort_order, ...fields } = parsed.data;

  let nextSortOrder = sort_order;

  if (nextSortOrder === undefined) {
    // Read the current maximum rather than counting rows: after a deletion a
    // count would hand out an order that has already been taken.
    const { data: last } = await sb
      .from("habits")
      .select("sort_order")
      .eq("user_id", ctx.user.internal_uuid)
      .is("archived_at", null)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    nextSortOrder = (last?.sort_order ?? -1) + 1;
  }

  const { data, error } = await sb
    .from("habits")
    .insert({
      user_id: ctx.user.internal_uuid,
      ...fields,
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("HABIT_LIMIT_REACHED"))
      return Response.json({ error: "HABIT_LIMIT_REACHED" }, { status: 400 });
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
});
