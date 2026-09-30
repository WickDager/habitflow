import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { TodoSchema } from "@/lib/schemas";
import { addDays, dateInTimezone, parseDateString, toDateString } from "@/lib/dates";
import { attachTags, setTodoTags } from "@/lib/todoTags";
import type { Recurrence, TodoRow } from "@/lib/database.types";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * The next due date for a recurrence rule, given the date it repeats from.
 *
 * Past-due occurrences are skipped: completing a daily task that was due a
 * week ago should schedule tomorrow, not spawn a fresh overdue row.
 */
function nextOccurrence(from: string, rule: Recurrence, today: string): string {
  const advance = (date: string): string => {
    if (rule.freq === "daily") return addDays(date, 1);

    if (rule.freq === "weekly") {
      if (!rule.byday?.length) return addDays(date, 7);
      // Walk forward to the next selected weekday.
      let candidate = addDays(date, 1);
      for (let i = 0; i < 7; i++) {
        if (rule.byday.includes(parseDateString(candidate).getDay()))
          return candidate;
        candidate = addDays(candidate, 1);
      }
      return candidate;
    }

    // Monthly: same day next month, clamped to the last day of that month so
    // a task on the 31st lands on the 28th/29th/30th rather than skipping.
    const base = parseDateString(from);
    const targetDay = rule.bymonthday ?? base.getDate();
    const monthIndex = base.getMonth() + 1;
    const year = base.getFullYear() + Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return toDateString(new Date(year, month, Math.min(targetDay, lastDay), 12));
  };

  let next = advance(from);
  // Bounded: a decade of daily occurrences is the most any rule can skip.
  for (let i = 0; i < 1000 && next <= today; i++) next = advance(next);
  return next;
}

export const PATCH = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const body = await req.json();
  const parsed = TodoSchema.partial().safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { tags, ...fields } = parsed.data;
  const sb = authenticatedClient(ctx.user.supabase_token);

  // Read before writing: a 404 has to be distinguishable from a real update,
  // the recurrence rule is needed to spawn the next occurrence, and the
  // completed transition has to be detected (re-sending is_completed: true on
  // an already-finished task must not spawn a second copy).
  const { data: current, error: readError } = await sb
    .from("todos")
    .select("*")
    .eq("id", id)
    .eq("user_id", ctx.user.internal_uuid)
    .maybeSingle();

  if (readError)
    return Response.json({ error: readError.message }, { status: 500 });
  if (!current) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const updates: Partial<TodoRow> = { ...fields };

  const completing = fields.is_completed === true && !current.is_completed;
  if (completing && updates.completed_at === undefined)
    updates.completed_at = new Date().toISOString();
  // Reopening a task clears the completion stamp; a stale timestamp would
  // otherwise skew any "completed today" reporting.
  if (fields.is_completed === false && updates.completed_at === undefined)
    updates.completed_at = null;

  let updated = current;
  if (Object.keys(updates).length > 0) {
    const { data, error } = await sb
      .from("todos")
      .update(updates)
      .eq("id", id)
      .eq("user_id", ctx.user.internal_uuid)
      .select();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    // Nothing matched: the row vanished between the read and the write.
    if (!data || data.length === 0)
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    updated = data[0];
  }

  if (tags !== undefined) {
    try {
      await setTodoTags(sb, id, ctx.user.internal_uuid, tags);
    } catch (err) {
      const message = err instanceof Error ? err.message : "tag link failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  // A recurring task is completed as an instance and repeats: finish this one
  // and create the next. The response carries both rows, with the updated task
  // at the top level so existing callers keep their shape.
  let nextTodo: (TodoRow & { tags: string[] }) | null = null;
  const rule = current.recurrence;
  if (completing && rule) {
    const today = ctx.profile.timezone
      ? dateInTimezone(ctx.profile.timezone)
      : toDateString(new Date());
    const from = current.due_date ?? today;
    const { data: created, error: createError } = await sb
      .from("todos")
      .insert({
        user_id: ctx.user.internal_uuid,
        title: current.title,
        due_date: nextOccurrence(from, rule, today),
        due_time: current.due_time,
        priority: current.priority,
        notes: current.notes,
        recurrence: rule,
        // A fresh instance starts its checklist over.
        subtasks: (current.subtasks ?? []).map((subtask) => ({
          ...subtask,
          done: false,
        })),
        sort_order: current.sort_order,
        // parent_id stays null: the next occurrence is a sibling, and a
        // non-null parent_id would make it a child of the task just finished.
      })
      .select()
      .single();

    if (createError)
      return Response.json({ error: createError.message }, { status: 500 });

    // The next occurrence inherits the tags, so the series stays labelled.
    let nextTags: string[] = [];
    if (tags !== undefined) {
      try {
        nextTags = await setTodoTags(sb, created.id, ctx.user.internal_uuid, tags);
      } catch (err) {
        const message = err instanceof Error ? err.message : "tag link failed";
        return Response.json({ error: message }, { status: 500 });
      }
    }
    nextTodo = { ...created, tags: nextTags };
  }

  try {
    const [withTags] = await attachTags(sb, [updated]);
    return Response.json({ ...withTags, next_occurrence: nextTodo });
  } catch (err) {
    const message = err instanceof Error ? err.message : "tag lookup failed";
    return Response.json({ error: message }, { status: 500 });
  }
});

export const DELETE = withAuth(async (req, ctx: AuthenticatedContext) => {
  const { id } = await (ctx.params as RouteParams["params"]);
  const sb = authenticatedClient(ctx.user.supabase_token);

  // `.select()` is what makes the 404 possible: the previous version always
  // answered 204, so the UI reported a successful delete when nothing matched.
  const { data, error } = await sb
    .from("todos")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.user.internal_uuid)
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // The link rows are not guaranteed to cascade with the todo.
  await sb.from("todo_tags").delete().eq("todo_id", id);

  return new Response(null, { status: 204 });
});
