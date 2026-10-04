import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import type { RoutineRow } from "@/lib/database.types";

/**
 * Routines — named bundles of habits, optionally limited to weekdays.
 *
 * Every query runs through the user-scoped client, so RLS decides visibility,
 * and additionally filters on user_id: RLS alone would make "someone else's id"
 * indistinguishable from "no such id", and a routine is never shared.
 */

const WeekdaysSchema = z.array(z.number().int().min(0).max(6)).max(7);

const RoutineInputSchema = z.object({
  name: z.string().min(1).max(50),
  // max(8) to match HabitSchema: Zod counts UTF-16 units, so a single emoji
  // carrying a variation selector (🏋️ = 3 units) would be rejected here too.
  icon: z.string().emoji().max(8).nullish(),
  /** 0=Sunday..6=Saturday. Empty/absent means every day (routines.days semantics). */
  days: WeekdaysSchema.optional(),
  /** Habit ids in display order; the array index becomes routine_items.sort_order. */
  habit_ids: z.array(z.string().uuid()).max(50).optional(),
});

type UserClient = ReturnType<typeof authenticatedClient>;

/**
 * Keep only ids that are this user's *own* habits, in the order given and
 * without duplicates (routine_items is keyed by routine_id + habit_id).
 *
 * Ownership matters because apply() writes a check-in for every item, and a
 * habit that was merely shared with this user is not ours to check in. Ids that
 * are not ours drop out silently — under RLS we cannot tell them apart from ids
 * that do not exist, and either way they are unusable here.
 */
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

/** Shape a routine for the client: its ordered items, with habit names resolved. */
async function attachItems(
  sb: UserClient,
  routine: RoutineRow,
  habitIds: string[]
) {
  if (habitIds.length === 0) return { ...routine, items: [] };

  const { data: habits } = await sb
    .from("habits")
    .select("id, name, icon, archived_at")
    .in("id", habitIds);

  const byId = new Map((habits ?? []).map((h) => [h.id, h]));

  return {
    ...routine,
    items: habitIds.map((habit_id, index) => {
      const habit = byId.get(habit_id);
      return {
        habit_id,
        sort_order: index,
        name: habit?.name ?? null,
        icon: habit?.icon ?? null,
        archived: habit ? habit.archived_at !== null : false,
      };
    }),
  };
}

export const GET = withAuth(async (req, ctx) => {
  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data: routines, error } = await sb
    .from("routines")
    .select("*")
    .eq("user_id", ctx.user.internal_uuid)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (routines.length === 0) return Response.json([]);

  const ids = routines.map((r) => r.id);

  const [itemsRes, habitsRes] = await Promise.all([
    sb
      .from("routine_items")
      .select("*")
      .in("routine_id", ids)
      .order("sort_order", { ascending: true }),
    // Unscoped on purpose: RLS returns the habits this user can see, which is
    // the set an item could ever point at.
    sb.from("habits").select("id, name, icon, archived_at"),
  ]);

  if (itemsRes.error || habitsRes.error)
    return Response.json({ error: "QUERY_FAILED" }, { status: 500 });

  const habits = new Map(habitsRes.data.map((h) => [h.id, h]));

  return Response.json(
    routines.map((routine) => ({
      ...routine,
      items: itemsRes.data
        .filter((item) => item.routine_id === routine.id)
        .map((item) => {
          const habit = habits.get(item.habit_id);
          return {
            habit_id: item.habit_id,
            sort_order: item.sort_order,
            name: habit?.name ?? null,
            icon: habit?.icon ?? null,
            // Archived habits stay in the routine but apply() skips them.
            archived: habit ? habit.archived_at !== null : false,
          };
        })
        // A habit hard-deleted underneath leaves a dead item behind.
        .filter((item) => item.name !== null),
    }))
  );
});

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const parsed = RoutineInputSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);
  const habitIds = await ownHabitIds(
    sb,
    ctx.user.internal_uuid,
    parsed.data.habit_ids ?? []
  );

  // New routines go to the end. Reading the current maximum (rather than
  // counting rows) keeps the order stable across deletions.
  const { data: last } = await sb
    .from("routines")
    .select("sort_order")
    .eq("user_id", ctx.user.internal_uuid)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: routine, error } = await sb
    .from("routines")
    .insert({
      user_id: ctx.user.internal_uuid,
      name: parsed.data.name,
      icon: parsed.data.icon ?? null,
      days: parsed.data.days ?? [],
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select()
    .single();

  if (error || !routine)
    return Response.json(
      { error: error?.message ?? "INSERT_FAILED" },
      { status: 500 }
    );

  if (habitIds.length > 0) {
    const { error: itemsError } = await sb.from("routine_items").insert(
      habitIds.map((habit_id, index) => ({
        routine_id: routine.id,
        habit_id,
        sort_order: index,
      }))
    );

    if (itemsError) {
      // PostgREST offers no transaction: undo the parent rather than leave an
      // empty routine behind.
      await sb.from("routines").delete().eq("id", routine.id);
      return Response.json({ error: itemsError.message }, { status: 500 });
    }
  }

  return Response.json(await attachItems(sb, routine, habitIds));
});
