import { z } from "zod";
import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import type { RoutineRow } from "@/lib/database.types";

type RouteParams = { params: Promise<{ id: string }> };

type UserClient = ReturnType<typeof authenticatedClient>;

const WeekdaysSchema = z.array(z.number().int().min(0).max(6)).max(7);

const RoutinePatchSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  // max(8) to match HabitSchema — see the note in src/app/api/routines/route.ts.
  icon: z.string().emoji().max(8).nullish(),
  days: WeekdaysSchema.optional(),
  sort_order: z.number().int().min(0).optional(),
  /** When present the item list is replaced wholesale, in the given order. */
  habit_ids: z.array(z.string().uuid()).max(50).optional(),
});

/** See routines/route.ts — same rule: only the user's own habits can be items. */
async function ownHabitIds(
  sb: UserClient,
  ownerId: string,
  ids: string[]
): Promise<string[]> {
  if (ids.length === 0) return [];

  const { data } = await sb
    .from("habits")
    .select("id")
    .eq("user_id", ownerId)
    .in("id", ids);

  const mine = new Set((data ?? []).map((h) => h.id));

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (mine.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/** A routine plus its ordered items, with habit names resolved for the client. */
async function detail(sb: UserClient, routine: RoutineRow) {
  const { data: items } = await sb
    .from("routine_items")
    .select("*")
    .eq("routine_id", routine.id)
    .order("sort_order", { ascending: true });

  const rows = items ?? [];
  if (rows.length === 0) return { ...routine, items: [] };

  const { data: habits } = await sb
    .from("habits")
    .select("id, name, icon, archived_at")
    .in(
      "id",
      rows.map((i) => i.habit_id)
    );

  const byId = new Map((habits ?? []).map((h) => [h.id, h]));

  return {
    ...routine,
    items: rows
      .map((item) => {
        const habit = byId.get(item.habit_id);
        return {
          habit_id: item.habit_id,
          sort_order: item.sort_order,
          name: habit?.name ?? null,
          icon: habit?.icon ?? null,
          archived: habit ? habit.archived_at !== null : false,
        };
      })
      .filter((item) => item.name !== null),
  };
}

export const PATCH = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const body = await req.json().catch(() => ({}));
  const parsed = RoutinePatchSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);
  const userId = ctx.user.internal_uuid;
  const { name, icon, days, sort_order, habit_ids } = parsed.data;

  // Look first so a routine belonging to someone else reads as 404, not 500.
  const { data: existing, error: findError } = await sb
    .from("routines")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (findError)
    return Response.json({ error: findError.message }, { status: 500 });
  if (!existing) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(days !== undefined ? { days } : {}),
    ...(sort_order !== undefined ? { sort_order } : {}),
  };

  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await sb
      .from("routines")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);

    if (updateError)
      return Response.json({ error: updateError.message }, { status: 500 });
  }

  if (habit_ids !== undefined) {
    const nextIds = await ownHabitIds(sb, userId, habit_ids);

    // Hold on to the current items: PostgREST hands us no transaction, and a
    // failed insert must not leave the user with an emptied routine.
    const { data: previous, error: previousError } = await sb
      .from("routine_items")
      .select("*")
      .eq("routine_id", id);

    // Abort before the delete, not after: if we could not read the items we
    // cannot restore them, and a wipe we cannot undo is worse than a failed save.
    if (previousError)
      return Response.json({ error: previousError.message }, { status: 500 });

    const { error: clearError } = await sb
      .from("routine_items")
      .delete()
      .eq("routine_id", id);
    if (clearError)
      return Response.json({ error: clearError.message }, { status: 500 });

    const rows = nextIds.map((habit_id, index) => ({
      routine_id: id,
      habit_id,
      sort_order: index,
    }));

    if (rows.length > 0) {
      const { error: insertError } = await sb
        .from("routine_items")
        .insert(rows);

      if (insertError) {
        if (previous && previous.length > 0) {
          const { error: restoreError } = await sb
            .from("routine_items")
            .insert(previous);
          // The user is already being told the save failed; log the rollback so
          // a routine left short of items is at least traceable in the logs.
          if (restoreError) console.error("routine restore failed:", restoreError);
        }
        return Response.json({ error: insertError.message }, { status: 500 });
      }
    }
  }

  // Re-read: the update above may have changed fields we echo back.
  const { data: updated, error: rereadError } = await sb
    .from("routines")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (rereadError)
    return Response.json({ error: rereadError.message }, { status: 500 });
  if (!updated) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return Response.json(await detail(sb, updated));
});

export const DELETE = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const sb = authenticatedClient(ctx.user.supabase_token);

  // Selecting the deleted rows is how we tell "deleted" from "never existed".
  const { data, error } = await sb
    .from("routines")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.user.internal_uuid)
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return new Response(null, { status: 204 });
});
