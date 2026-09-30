import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { addDays, dateInTimezone } from "@/lib/dates";

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
      // The last seven days in the caller's local calendar. This was the only
      // remaining UTC day on a user-visible path: it produced an eight-day
      // window for everyone, and for users east of UTC a window shifted half a
      // day off, so "this week" read low and the perfect-week badge was
      // effectively unreachable.
      .gte("date", addDays(dateInTimezone(ctx.profile.timezone || "UTC"), -6)),
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
