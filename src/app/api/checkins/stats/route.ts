import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";

export const GET = withAuth(async (req, ctx) => {
  const sb = authenticatedClient(ctx.user.supabase_token);
  const userId = ctx.user.internal_uuid;

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
      .limit(14),
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
