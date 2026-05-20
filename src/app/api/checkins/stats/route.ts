import { withAuth } from "@/lib/withAuth";
import { serverClient } from "@/lib/supabase";

export const GET = (req: Request) =>
  withAuth(req, async (req, user) => {
    const sb = serverClient();
    const userRow = await sb
      .from("users")
      .select("id")
      .eq("telegram_id", user.id)
      .single();

    if (!userRow.data)
      return Response.json({ error: "USER_NOT_FOUND" }, { status: 404 });

    const userId = userRow.data.id;

    const [streaksRes, moodsRes, weeklyRes] = await Promise.all([
      sb
        .from("habit_streaks")
        .select("*")
        .eq("user_id", userId),
      sb
        .from("checkins")
        .select("habit_id, mood, date")
        .eq("user_id", userId)
        .not("mood", "is", null)
        .order("date", { ascending: false })
        .limit(7),
      sb
        .from("checkins")
        .select("habit_id, completed, date")
        .eq("user_id", userId)
        .gte("date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
    ]);

    if (streaksRes.error || moodsRes.error || weeklyRes.error)
      return Response.json(
        { error: "QUERY_FAILED" },
        { status: 500 }
      );

    return Response.json({
      streaks: streaksRes.data,
      recentMoods: moodsRes.data,
      weekly: weeklyRes.data,
    });
  });
