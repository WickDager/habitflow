import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { TodoSchema } from "@/lib/schemas";
import { parseTaskInput } from "@/lib/nlpDate";
import { dateInTimezone, todayLocal } from "@/lib/dates";
import { attachTags, setTodoTags } from "@/lib/todoTags";

type TodoFilter = "all" | "today" | "overdue" | "high";

function parseFilter(value: string | null): TodoFilter {
  return value === "today" || value === "overdue" || value === "high"
    ? value
    : "all";
}

export const GET = withAuth(async (req, ctx) => {
  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const tag = url.searchParams.get("tag");
  const sb = authenticatedClient(ctx.user.supabase_token);

  // "Today" is the caller's calendar day, not the server's. The client sends
  // its own date when it knows it (the device is authoritative for this user);
  // otherwise fall back to the timezone stored on their profile.
  const clientDate = url.searchParams.get("date");
  const today = /^\d{4}-\d{2}-\d{2}$/.test(clientDate ?? "")
    ? clientDate!
    : ctx.profile.timezone
      ? dateInTimezone(ctx.profile.timezone)
      : todayLocal();

  // Tags live in a side table, so a tag filter is resolved to todo ids first.
  let tagFilteredIds: string[] | null = null;
  if (tag) {
    const { data: tagRow, error: tagError } = await sb
      .from("tags")
      .select("id")
      .eq("user_id", ctx.user.internal_uuid)
      .eq("name", tag.trim().toLowerCase())
      .maybeSingle();
    if (tagError)
      return Response.json({ error: tagError.message }, { status: 500 });
    if (!tagRow) return Response.json([]);

    const { data: links, error: linkError } = await sb
      .from("todo_tags")
      .select("todo_id")
      .eq("tag_id", tagRow.id);
    if (linkError)
      return Response.json({ error: linkError.message }, { status: 500 });
    tagFilteredIds = (links ?? []).map((link) => link.todo_id);
    if (tagFilteredIds.length === 0) return Response.json([]);
  }

  let query = sb
    .from("todos")
    .select("*")
    .eq("user_id", ctx.user.internal_uuid);

  if (filter === "today") query = query.eq("due_date", today);
  else if (filter === "overdue")
    // Past due and still open: a completed task is never "overdue".
    query = query.lt("due_date", today).eq("is_completed", false);
  // 3 is the top priority bucket; the list orders by priority desc.
  else if (filter === "high") query = query.gte("priority", 3);

  if (tagFilteredIds) query = query.in("id", tagFilteredIds);

  const { data, error } = await query
    .order("is_completed", { ascending: true })
    .order("priority", { ascending: false })
    // A task with no due date sorts after every dated task, not before them.
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  try {
    return Response.json(await attachTags(sb, data ?? []));
  } catch (err) {
    const message = err instanceof Error ? err.message : "tag lookup failed";
    return Response.json({ error: message }, { status: 500 });
  }
});

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = TodoSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { tags: suppliedTags, ...fields } = parsed.data;
  let tagNames = suppliedTags;

  // Natural-language fallback, for the bot and the quick-add bar alike:
  // `{title: "call mom tomorrow 6pm"}` should land on the right day without
  // the caller parsing anything. Only fills in what the caller left out, and
  // the saved title drops the words it consumed, so the task reads "call mom"
  // rather than repeating its own due date.
  if (fields.due_date === undefined || fields.due_time === undefined) {
    const nlp = parseTaskInput(fields.title);
    if (fields.due_date === undefined && nlp.dueDate)
      fields.due_date = nlp.dueDate;
    if (fields.due_time === undefined && nlp.dueTime)
      fields.due_time = nlp.dueTime;
    if (fields.priority === undefined && nlp.priority !== undefined)
      fields.priority = nlp.priority;
    if (tagNames === undefined && nlp.tags?.length) tagNames = nlp.tags;
    if (nlp.title.trim()) fields.title = nlp.title.trim();
  }

  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data, error } = await sb
    .from("todos")
    .insert({ user_id: ctx.user.internal_uuid, ...fields })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Tags are linked after the insert because todo_tags needs the todo's id.
  let linked: string[] = [];
  if (tagNames?.length) {
    try {
      linked = await setTodoTags(
        sb,
        data.id,
        ctx.user.internal_uuid,
        tagNames,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "tag link failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  return Response.json({ ...data, tags: linked });
});
