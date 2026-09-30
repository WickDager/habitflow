import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { dateInTimezone } from "@/lib/dates";
import { computeInsights, loadInsightInputs } from "@/lib/reportImage";

/** Matches the 5-week heatmap the client renders. */
const DEFAULT_DAYS = 35;
/** Upper bound so a stray `?days=100000` cannot turn into an unbounded scan. */
const MAX_DAYS = 90;

export const GET = withAuth(async (req, ctx) => {
  const raw = new URL(req.url).searchParams.get("days");
  const parsed = raw === null ? DEFAULT_DAYS : Number(raw);
  const days = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), 1), MAX_DAYS)
    : DEFAULT_DAYS;

  const sb = authenticatedClient(ctx.user.supabase_token);
  // "Today" is the user's local day, not the server's: the window has to end on
  // the day they are actually living in.
  const today = dateInTimezone(ctx.profile.timezone);

  const { data, failed } = await loadInsightInputs(
    sb,
    ctx.user.internal_uuid,
    today,
    days
  );
  if (failed || !data)
    return Response.json({ error: "QUERY_FAILED" }, { status: 500 });

  return Response.json(
    computeInsights({
      checkins: data.checkins,
      habits: data.habits,
      streaks: data.streaks,
      today,
      days,
      timezone: ctx.profile.timezone,
    })
  );
});
