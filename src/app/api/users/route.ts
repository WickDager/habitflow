import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";

export const POST = withAuth(async (req, ctx) => {
  const sb = authenticatedClient(ctx.user.supabase_token);
  const { data, error } = await sb
    .from("users")
    .select("id, telegram_id, first_name, reminder_enabled")
    .eq("id", ctx.user.internal_uuid)
    .single();

  if (error)
    return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
});
