import { z } from "zod";
import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient } from "@/lib/supabase";
import { localTimeInTimezone, reminderKinds } from "@/lib/reminders";
import type { ReminderKinds, Tables, UserRow } from "@/lib/database.types";

/**
 * Reminder preferences — GET / PATCH /api/settings
 *
 * The single writer of the reminder columns on `users`. The scheduler
 * (@/lib/reminders) and the bot's webhook both read those columns, so routing
 * every change through here is what keeps the UI and the bot from disagreeing.
 *
 * Both methods answer with the same shape, mirrored by `SettingsResponse` in
 * SettingsSheet.tsx:
 *   { reminder_enabled, reminder_kinds, morning_hour, evening_hour,
 *     reminder_hour, quiet_hours_start, quiet_hours_end, max_daily_messages,
 *     timezone, localTime }
 */

interface SettingsResponse {
  reminder_enabled: boolean;
  reminder_kinds: ReminderKinds;
  morning_hour: number;
  evening_hour: number;
  reminder_hour: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  max_daily_messages: number;
  timezone: string;
  /** The caller's local time right now, "HH:MM" — proves the timezone is right. */
  localTime: string;
}

const HourSchema = z.number().int().min(0).max(23);

/**
 * Deliberate omissions, because Zod strips unknown keys by default:
 *  - `timezone` is never client-set. apiFetch sends the device timezone as an
 *    `x-timezone` header and withAuth stores it, so the UI only displays it.
 *  - `localTime` is derived per request, never stored.
 * Stripping rather than rejecting means a caller can PATCH a whole GET
 * response back (the obvious round-trip) and those two are simply ignored.
 */
const SettingsPatchSchema = z.object({
  reminder_enabled: z.boolean().optional(),
  // Partial by design: a caller may flip one kind without restating the rest.
  reminder_kinds: z
    .object({
      morning: z.boolean().optional(),
      nudge: z.boolean().optional(),
      evening: z.boolean().optional(),
      weekly: z.boolean().optional(),
    })
    .optional(),
  morning_hour: HourSchema.optional(),
  evening_hour: HourSchema.optional(),
  reminder_hour: HourSchema.optional(),
  quiet_hours_start: HourSchema.optional(),
  quiet_hours_end: HourSchema.optional(),
  max_daily_messages: z.number().int().min(1).max(10).optional(),
});

/** The caller's row normalised to the response shape. */
function toSettings(user: UserRow): SettingsResponse {
  // Fallbacks mirror the scheduler's own defaults (@/lib/reminders
  // slotHourFor) so the sheet can never display a value the scheduler would
  // not use for a row whose columns are null.
  //
  // Quiet hours fall back to 0/0, not to a typical 22/7: isQuietHour() reads
  // start === end as "no quiet hours", so an untouched window stays off
  // instead of silently silencing the night on the first save.
  const tz = user.timezone || "UTC";
  return {
    reminder_enabled: Boolean(user.reminder_enabled),
    reminder_kinds: reminderKinds(user),
    morning_hour: user.morning_hour ?? 8,
    evening_hour: user.evening_hour ?? 21,
    reminder_hour: user.reminder_hour ?? 20,
    quiet_hours_start: user.quiet_hours_start ?? 0,
    quiet_hours_end: user.quiet_hours_end ?? 0,
    max_daily_messages: user.max_daily_messages ?? 3,
    timezone: tz,
    localTime: localTimeInTimezone(tz),
  };
}

/** Reads the caller's own row through the RLS-scoped client. */
async function readSettings(
  ctx: AuthenticatedContext
): Promise<SettingsResponse | null> {
  const sb = authenticatedClient(ctx.user.supabase_token);
  const { data, error } = await sb
    .from("users")
    .select("*")
    .eq("id", ctx.user.internal_uuid)
    .single();

  if (error || !data) return null;
  return toSettings(data as UserRow);
}

export const GET = withAuth(async (_req, ctx) => {
  const settings = await readSettings(ctx);
  if (!settings)
    return Response.json({ error: "DB_READ_FAILED" }, { status: 500 });
  return Response.json(settings);
});

export const PATCH = withAuth(async (req, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = SettingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "INVALID_SETTINGS",
        // Readable on its own: "max_daily_messages: Too big: expected number to be <=10"
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`
        ),
      },
      { status: 400 }
    );
  }

  const patch = parsed.data;
  const update: Tables["users"]["Update"] = {};

  if (patch.reminder_enabled !== undefined)
    update.reminder_enabled = patch.reminder_enabled;
  if (patch.morning_hour !== undefined) update.morning_hour = patch.morning_hour;
  if (patch.evening_hour !== undefined) update.evening_hour = patch.evening_hour;
  if (patch.reminder_hour !== undefined)
    update.reminder_hour = patch.reminder_hour;
  if (patch.quiet_hours_start !== undefined)
    update.quiet_hours_start = patch.quiet_hours_start;
  if (patch.quiet_hours_end !== undefined)
    update.quiet_hours_end = patch.quiet_hours_end;
  if (patch.max_daily_messages !== undefined)
    update.max_daily_messages = patch.max_daily_messages;

  if (patch.reminder_kinds) {
    // Merge into the stored object instead of replacing it: a caller flipping
    // one kind must not wipe the other three. ctx.profile was read moments ago
    // in withAuth, so it is the merge base without a second round trip.
    update.reminder_kinds = {
      ...reminderKinds(ctx.profile),
      ...patch.reminder_kinds,
    };
  }

  if (Object.keys(update).length === 0) {
    // Nothing recognised (an empty body, or a round-tripped GET). No write and
    // no error — the caller already has the state it asked for.
    return Response.json(toSettings(ctx.profile));
  }

  const sb = authenticatedClient(ctx.user.supabase_token);
  const { data, error } = await sb
    .from("users")
    .update(update)
    // Explicit id filter on top of the RLS policy: this must only ever touch
    // the caller's own row.
    .eq("id", ctx.user.internal_uuid)
    .select("*")
    .single();

  if (error || !data)
    return Response.json(
      { error: error?.message ?? "DB_WRITE_FAILED" },
      { status: 500 }
    );

  return Response.json(toSettings(data as UserRow));
});
