import { runReminderTick } from "@/lib/notify";

/** Throttled sends can outlast the default function budget — see /api/cron/tick. */
export const maxDuration = 60;

/**
 * Vercel's built-in daily cron still points here, so this stays as the backstop
 * for the 10-minute `/api/cron/tick`: it runs the same engine (no forked logic)
 * and additionally catches up the weekly report for anyone whose local weekday
 * is Sunday and who is already past their weekly slot hour. Whichever path runs
 * first wins, and the `reminder_log` ledger makes the other one a no-op.
 */
export async function GET(request: Request) {
  // Fail closed when CRON_SECRET is unset, so a request with the literal header
  // "Bearer undefined" cannot match a missing secret.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`)
    return new Response("Unauthorized", { status: 401 });

  try {
    const summary = await runReminderTick({ forceWeeklyOnSunday: true });
    return Response.json(summary);
  } catch (err) {
    console.error("cron failed:", err);
    return Response.json({ error: "TICK_FAILED" }, { status: 500 });
  }
}
