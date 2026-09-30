import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { TagSchema, normalizeTagName } from "@/lib/schemas";

export const GET = withAuth(async (_req, ctx) => {
  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data, error } = await sb
    .from("tags")
    .select("*")
    .eq("user_id", ctx.user.internal_uuid)
    .order("name", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
});

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = TagSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const name = normalizeTagName(parsed.data.name);
  // "###" passes the length check but normalises to nothing.
  if (!name) return Response.json({ error: "INVALID_TAG" }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);

  // Creating a tag that already exists returns the existing one: the tag
  // picker's inline create runs on every Enter, and a 409 there would be a
  // dead end for the user with nothing to act on.
  const { error: upsertError } = await sb
    .from("tags")
    .upsert(
      { user_id: ctx.user.internal_uuid, name, color: parsed.data.color ?? null },
      { onConflict: "user_id,name", ignoreDuplicates: true },
    );
  if (upsertError)
    return Response.json({ error: upsertError.message }, { status: 500 });

  const { data, error } = await sb
    .from("tags")
    .select("*")
    .eq("user_id", ctx.user.internal_uuid)
    .eq("name", name)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  return Response.json(data);
});
