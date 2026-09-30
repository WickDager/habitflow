import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { normalizeTagName } from "./schemas";

/**
 * Shared tag plumbing for the todos and tags routes.
 *
 * Tags are a many-to-many side table, so every write path needs the same three
 * steps: normalise the names, make sure a `tags` row exists for each, then
 * replace the `todo_tags` links. Keeping it here means POST /api/todos,
 * PATCH /api/todos/[id] and /api/tags cannot drift apart.
 *
 * Lives in lib rather than in one of the route files: a helper exported from
 * `route.ts` is rejected by Next's route type validation, which only allows
 * HTTP method exports and route segment config.
 */

type Sb = SupabaseClient<Database>;

/** Normalise, drop empties ("###" normalises to ""), and de-duplicate. */
export function cleanTagNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = normalizeTagName(raw);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Insert whichever of `names` do not exist yet. Returns a name -> id map.
 *
 * Uses ignore-duplicates so this needs only an INSERT policy on `tags` and is
 * safe against two concurrent creates of the same name; the following select
 * then reads back the rows that already existed.
 */
export async function ensureTags(
  sb: Sb,
  userId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  const clean = cleanTagNames(names);
  const byName = new Map<string, string>();
  if (clean.length === 0) return byName;

  const { error: upsertError } = await sb
    .from("tags")
    .upsert(
      clean.map((name) => ({ user_id: userId, name })),
      { onConflict: "user_id,name", ignoreDuplicates: true },
    );
  if (upsertError) throw new Error(upsertError.message);

  const { data, error } = await sb
    .from("tags")
    .select("id, name")
    .eq("user_id", userId)
    .in("name", clean);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) byName.set(row.name, row.id);
  return byName;
}

/** Replace a todo's tag links with exactly `names`. Returns the names kept. */
export async function setTodoTags(
  sb: Sb,
  todoId: string,
  userId: string,
  names: readonly string[],
): Promise<string[]> {
  const clean = cleanTagNames(names);

  const { error: clearError } = await sb
    .from("todo_tags")
    .delete()
    .eq("todo_id", todoId);
  if (clearError) throw new Error(clearError.message);

  if (clean.length === 0) return [];

  const tagIds = await ensureTags(sb, userId, clean);
  const links = clean
    .map((name) => tagIds.get(name))
    .filter((tagId): tagId is string => Boolean(tagId))
    .map((tag_id) => ({ todo_id: todoId, tag_id }));

  if (links.length === 0) return [];

  const { error: linkError } = await sb.from("todo_tags").insert(links);
  if (linkError) throw new Error(linkError.message);

  return clean.filter((name) => tagIds.has(name));
}

/**
 * Attach `tags: string[]` to each todo, alphabetically.
 *
 * Two flat queries rather than a PostgREST embed: the generated Database
 * types declare no relationships, so `select("*, todo_tags(tags(name))")`
 * does not type-check.
 */
export async function attachTags<T extends { id: string }>(
  sb: Sb,
  todos: readonly T[],
): Promise<(T & { tags: string[] })[]> {
  const withTags = todos.map((todo) => ({ ...todo, tags: [] as string[] }));
  const ids = todos.map((todo) => todo.id);
  if (ids.length === 0) return withTags;

  const { data: links, error: linkError } = await sb
    .from("todo_tags")
    .select("todo_id, tag_id")
    .in("todo_id", ids);
  if (linkError) throw new Error(linkError.message);
  if (!links || links.length === 0) return withTags;

  const tagIds = [...new Set(links.map((link) => link.tag_id))];
  const { data: tags, error: tagError } = await sb
    .from("tags")
    .select("id, name")
    .in("id", tagIds);
  if (tagError) throw new Error(tagError.message);

  const nameById = new Map((tags ?? []).map((tag) => [tag.id, tag.name]));
  const byTodo = new Map<string, string[]>();
  for (const link of links) {
    const name = nameById.get(link.tag_id);
    if (!name) continue;
    const list = byTodo.get(link.todo_id);
    if (list) list.push(name);
    else byTodo.set(link.todo_id, [name]);
  }

  for (const todo of withTags) {
    const list = byTodo.get(todo.id);
    if (list) todo.tags = list.sort((a, b) => a.localeCompare(b));
  }
  return withTags;
}
