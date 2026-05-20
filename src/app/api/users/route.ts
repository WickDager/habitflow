import { withAuth } from "@/lib/withAuth";
import { serverClient } from "@/lib/supabase";

export const POST = (req: Request) =>
  withAuth(req, async (req, user) => {
    const sb = serverClient();
    const { data, error } = await sb
      .from("users")
      .upsert(
        {
          telegram_id: user.id,
          first_name: user.first_name,
          username: user.username,
          language_code: user.language_code,
        },
        { onConflict: "telegram_id" }
      )
      .select("id, telegram_id, first_name, reminder_enabled")
      .single();

    if (error)
      return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  });
