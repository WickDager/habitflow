import { withAuth } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { dateInTimezone } from "@/lib/dates";
import {
  buildReportCard,
  computeInsights,
  loadInsightInputs,
  renderReportImage,
} from "@/lib/reportImage";

/** The card is a week in review: the bar strip and % cover the last 7 days. */
const REPORT_DAYS = 7;

export const GET = withAuth(async (req, ctx) => {
  const format = new URL(req.url).searchParams.get("format") ?? "image";

  const sb = authenticatedClient(ctx.user.supabase_token);
  const today = dateInTimezone(ctx.profile.timezone);

  const { data, failed } = await loadInsightInputs(
    sb,
    ctx.user.internal_uuid,
    today,
    REPORT_DAYS
  );
  if (failed || !data)
    return Response.json({ error: "QUERY_FAILED" }, { status: 500 });

  const insights = computeInsights({
    checkins: data.checkins,
    habits: data.habits,
    streaks: data.streaks,
    today,
    days: REPORT_DAYS,
    timezone: ctx.profile.timezone,
  });

  const card = buildReportCard({
    insights,
    firstName: ctx.profile.first_name,
    languageCode: ctx.profile.language_code,
  });

  // `format=json` hands the app the same numbers so it can render them natively;
  // anything else (including a missing or unknown value) renders the PNG.
  if (format === "json") return Response.json(card);

  return renderReportImage(card);
});
