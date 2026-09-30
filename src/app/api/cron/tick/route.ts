import { runReminderTick } from "@/lib/notify";

/**
 * Sending is throttled to respect the Bot API, so a batch of users can outlast
 * the platform's default function budget and be cut off mid-run. The route
 * itself is dynamic by default (reading `request.headers` below guarantees it),
 * so `maxDuration` is the only segment config needed.
 */
export const maxDuration = 60;

/**
 * The reminder tick. Supabase `pg_cron` + `pg_net` call this every ~10 minutes
 * (Vercel Hobby cannot run sub-daily crons), which is why every send has to be
 * idempotent — the ledger in `reminder_log` is what guarantees that.
 *
 * Auth is a shared bearer secret, failing closed when CRON_SECRET is unset:
 * without that guard a request carrying the literal header "Bearer undefined"
 * would match `process.env.CRON_SECRET` being undefined.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`)
    return new Response("Unauthorized", { status: 401 });

  try {
    const summary = await runReminderTick();
    return Response.json(summary);
  } catch (err) {
    console.error("cron/tick failed:", err);
    return Response.json({ error: "TICK_FAILED" }, { status: 500 });
  }
}

/**
 * `pg_net` can be configured with `net.http_get` or `net.http_post`, and nothing
 * ships the SQL that picks one — answering only GET would turn a wrong guess into
 * silent silence (405, no reminders, no logs). Both verbs hit the same
 * handler behind the same secret.
 */
export const POST = GET;
