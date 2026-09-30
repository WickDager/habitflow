import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { dateInTimezone } from "@/lib/dates";

/**
 * Focus of the day — up to three habits pinned to the top of My Day.
 *
 * POST   { habit_id, date }  toggles one habit on/off and returns the day's
 *                            full focus list, so the client never has to
 *                            guess what the server ended up with.
 * DELETE ?date=YYYY-MM-DD    clears the day, returning what was cleared so
 *                            the client can offer an undo.
 *
 * The cap is enforced here, not in the UI: the picker also disables a fourth
 * choice, but a stale tab or a direct call must not be able to pin ten.
 */

/** Keep in step with the picker's copy ("Pick up to 3 habits..."). */
const FOCUS_LIMIT = 3;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client's own local date when it sends one, else the profile timezone. */
function resolveDate(value: unknown, ctx: AuthenticatedContext): string {
  return typeof value === "string" && DATE_RE.test(value)
    ? value
    : dateInTimezone(ctx.profile.timezone);
}

async function focusIdsFor(
  sb: ReturnType<typeof authenticatedClient>,
  userId: string,
  date: string
): Promise<{ ids: string[]; error?: string }> {
  const { data, error } = await sb
    .from("daily_focus")
    .select("habit_id")
    .eq("user_id", userId)
    .eq("date", date);
  if (error) return { ids: [], error: error.message };
  return { ids: ((data ?? []) as { habit_id: string }[]).map((r) => r.habit_id) };
}

export const POST = withAuth(async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as {
    habit_id?: unknown;
    date?: unknown;
  };

  if (typeof body.habit_id !== "string" || !UUID_RE.test(body.habit_id))
    return Response.json({ error: "INVALID_HABIT" }, { status: 400 });

  const habitId = body.habit_id;
  const date = resolveDate(body.date, ctx);
  const userId = ctx.user.internal_uuid;
  const sb = authenticatedClient(ctx.user.supabase_token);

  const current = await focusIdsFor(sb, userId, date);
  if (current.error)
    return Response.json({ error: current.error }, { status: 500 });

  // Toggle: pressing a pinned habit unpins it.
  if (current.ids.includes(habitId)) {
    const { error } = await sb
      .from("daily_focus")
      .delete()
      .eq("user_id", userId)
      .eq("date", date)
      .eq("habit_id", habitId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      date,
      focus: current.ids.filter((id) => id !== habitId),
      toggled: false,
    });
  }

  // Count-then-insert is not atomic: two requests in flight could both see two
  // rows and both insert. The client guards the fourth tap, and the worst case
  // is a stray pin, which is cosmetic. A unique/total-count constraint in the
  // migration would be the real fix.
  if (current.ids.length >= FOCUS_LIMIT)
    return Response.json({ error: "FOCUS_LIMIT" }, { status: 400 });

  // Pin a habit that exists and is still live: a FK violation or a pin on an
  // archived habit would show a nameless chip in the focus row.
  const { data: habit, error: habitError } = await sb
    .from("habits")
    .select("id")
    .eq("id", habitId)
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();
  if (habitError)
    return Response.json({ error: habitError.message }, { status: 500 });
  if (!habit)
    return Response.json({ error: "HABIT_NOT_FOUND" }, { status: 404 });

  const { error } = await sb
    .from("daily_focus")
    .insert({ user_id: userId, habit_id: habitId, date });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    date,
    focus: [...current.ids, habitId],
    toggled: true,
  });
});
