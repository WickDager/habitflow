import { z } from "zod";
import { withAuth, type AuthenticatedContext } from "@/lib/withAuth";
import { authenticatedClient, serverClient } from "@/lib/supabase";
import { sendMiniAppButton } from "@/lib/telegram";
import { addDays, dateInTimezone } from "@/lib/dates";
import { dictionaryFor } from "@/lib/i18n/dictionary";

/**
 * Accountability partners (habit_shares).
 *
 * Read as the user so RLS decides which rows are ours, then enrich with the
 * service-role client. The extra SELECT policies on a shared habit only cover
 * *accepted* members, but the sheet has to name the habit in a pending invite
 * and name the person on the other side, and nobody can read another user's
 * `users` row under RLS at all. Every enrichment below is keyed by a row the
 * user-scoped query already proved this caller is a party to.
 */

const InviteSchema = z.object({
  habit_id: z.string().uuid(),
  telegram_id: z.number().int().positive(),
});

const RespondSchema = z.object({
  habit_id: z.string().uuid(),
  action: z.enum(["accept", "decline"]),
});

/** Escapes user-controlled habit names before they go into an HTML message. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const GET = withAuth(async (req, ctx: AuthenticatedContext) => {
  const uid = ctx.user.internal_uuid;
  const sb = authenticatedClient(ctx.user.supabase_token);

  const { data: shares, error } = await sb
    .from("habit_shares")
    .select("*")
    .or(`owner_id.eq.${uid},member_id.eq.${uid}`)
    .order("created_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (shares.length === 0) return Response.json([]);

  const habitIds = [...new Set(shares.map((s) => s.habit_id))];
  const partnerIds = [
    ...new Set(
      shares.map((s) => (s.owner_id === uid ? s.member_id : s.owner_id))
    ),
  ];

  const admin = serverClient();

  // A shared habit has ONE check-in row per day (checkins is unique on
  // habit_id + date) and ONE streak row (habit_streaks is keyed by habit_id),
  // so there is no such thing as "my streak" and "their streak" for a shared
  // habit — both people advance the same row. That is also what makes the
  // looser rule natural: a day counts if *either* of you completed it.
  const [habitsRes, partnersRes, streakRes, contribRes] = await Promise.all([
    admin.from("habits").select("id, name, icon").in("id", habitIds),
    admin.from("users").select("id, first_name, username").in("id", partnerIds),
    admin
      .from("habit_streaks")
      .select("habit_id, current_streak, total_completions, last_completed")
      .in("habit_id", habitIds),
    // Who actually did the work, per person. `user_id` on the single daily row
    // records whoever completed it, so this is a real contribution count.
    admin
      .from("checkins")
      .select("habit_id, user_id")
      .in("habit_id", habitIds)
      .eq("completed", true),
  ]);

  if (
    habitsRes.error ||
    partnersRes.error ||
    streakRes.error ||
    contribRes.error
  )
    return Response.json({ error: "QUERY_FAILED" }, { status: 500 });

  const habits = new Map((habitsRes.data ?? []).map((h) => [h.id, h]));
  const partners = new Map((partnersRes.data ?? []).map((u) => [u.id, u]));
  const streaks = new Map(
    (streakRes.data ?? []).map((s) => [s.habit_id, s])
  );

  const contributions = new Map<string, number>();
  for (const row of contribRes.data ?? []) {
    const key = `${row.habit_id}:${row.user_id}`;
    contributions.set(key, (contributions.get(key) ?? 0) + 1);
  }

  // Same staleness guard as /api/streak: habit_streaks only recomputes when a
  // check-in changes, so an abandoned habit keeps its last value forever.
  const today = dateInTimezone(ctx.profile.timezone || "UTC");
  const yesterday = addDays(today, -1);

  return Response.json(
    shares.map((share) => {
      const iAmOwner = share.owner_id === uid;
      const partnerId = iAmOwner ? share.member_id : share.owner_id;
      const habit = habits.get(share.habit_id);
      const partner = partners.get(partnerId);

      const streak = streaks.get(share.habit_id);
      const lastCompleted = streak?.last_completed ?? null;
      const live = lastCompleted !== null && lastCompleted >= yesterday;
      const myDays = contributions.get(`${share.habit_id}:${uid}`) ?? 0;
      const partnerDays =
        contributions.get(`${share.habit_id}:${partnerId}`) ?? 0;

      return {
        habit_id: share.habit_id,
        owner_id: share.owner_id,
        member_id: share.member_id,
        status: share.status,
        created_at: share.created_at,
        role: iAmOwner ? "owner" : "member",
        habit: habit
          ? { id: habit.id, name: habit.name, icon: habit.icon }
          : null,
        partner: partner
          ? {
              id: partner.id,
              first_name: partner.first_name,
              username: partner.username,
            }
          : null,
        /** Days this caller personally completed the habit. */
        my_days: myDays,
        /** Days the partner personally completed it. */
        partner_days: partnerDays,
        /**
         * The shared streak counts a day as kept if *either* partner completed
         * it, so it only breaks when you both miss. That is the single
         * habit_streaks row for this habit, guarded against staleness above.
         *
         * The previous rule was min(my_streak, partner_streak), which could
         * only ever be 0: habit_streaks is keyed by habit_id, so a partner's
         * row for the same habit cannot exist.
         */
        together_days: live ? (streak?.current_streak ?? 0) : 0,
        together_total: streak?.total_completions ?? 0,
      };
    })
  );
});

export const POST = withAuth(async (req, ctx: AuthenticatedContext) => {
  const uid = ctx.user.internal_uuid;
  const body = await req.json().catch(() => ({}));
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);

  // You can only invite someone to a habit you own.
  const { data: habit, error: habitError } = await sb
    .from("habits")
    .select("id, name, icon")
    .eq("id", parsed.data.habit_id)
    .eq("user_id", uid)
    .maybeSingle();

  if (habitError)
    return Response.json({ error: habitError.message }, { status: 500 });
  if (!habit) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // The inviter cannot read another user's row under RLS, so resolve the
  // invitee with the service role.
  const admin = serverClient();
  const { data: target, error: targetError } = await admin
    .from("users")
    .select("id, telegram_id, chat_id, language_code, first_name")
    .eq("telegram_id", parsed.data.telegram_id)
    .maybeSingle();

  if (targetError)
    return Response.json({ error: targetError.message }, { status: 500 });
  // Codes, not sentences: the client renders them through t() so both partners
  // read them in their own language.
  if (!target)
    return Response.json({ error: "partnerNeedsStart" }, { status: 400 });
  if (target.id === uid)
    return Response.json({ error: "partnerCantInviteSelf" }, { status: 400 });

  const { data: existing } = await sb
    .from("habit_shares")
    .select("*")
    .eq("habit_id", habit.id)
    .eq("owner_id", uid)
    .eq("member_id", target.id)
    .maybeSingle();

  let share = existing ?? null;
  // Only a real state change earns a Telegram message: inviting someone who is
  // already pending is a no-op, and pinging them again would just be noise.
  let notify = false;

  if (existing) {
    // Re-inviting after a decline puts it back in front of them; an invite that
    // is already pending or accepted stays as it is (inviting twice is a no-op).
    if (existing.status === "declined") {
      const { data: updated, error } = await sb
        .from("habit_shares")
        .update({ status: "pending" })
        .eq("habit_id", habit.id)
        .eq("owner_id", uid)
        .eq("member_id", target.id)
        .select()
        .maybeSingle();
      if (error)
        return Response.json({ error: error.message }, { status: 500 });
      share = updated ?? existing;
      notify = updated?.status === "pending";
    }
  } else {
    const { data: inserted, error } = await sb
      .from("habit_shares")
      .insert({
        habit_id: habit.id,
        owner_id: uid,
        member_id: target.id,
        status: "pending",
      })
      .select()
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    share = inserted;
    notify = !!inserted;
  }

  // Tell them, but never fail the invite because Telegram is unhappy. The
  // invitee reads this in their own language, not the inviter's.
  if (notify && target.chat_id && share?.status === "pending") {
    // Was `=== "ru" ? ru : en`, which sent an English invite to Ukrainian and
    // Belarusian speakers while the rest of the app served them Russian.
    const dict = dictionaryFor(target.language_code);
    const text =
      `${escapeHtml(ctx.profile.first_name)}: ` +
      `${habit.icon ?? "🎯"} <b>${escapeHtml(habit.name)}</b>\n` +
      dict.partnerHint;
    try {
      await sendMiniAppButton(target.chat_id, text, dict.botOpenApp);
    } catch (err) {
      console.error("partner invite message failed:", err);
    }
  }

  return Response.json(share);
});

export const PATCH = withAuth(async (req, ctx: AuthenticatedContext) => {
  const uid = ctx.user.internal_uuid;
  const body = await req.json().catch(() => ({}));
  const parsed = RespondSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);
  const status = parsed.data.action === "accept" ? "accepted" : "declined";

  const { data, error } = await sb
    .from("habit_shares")
    .update({ status })
    .eq("habit_id", parsed.data.habit_id)
    .eq("member_id", uid)
    .select()
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return Response.json(data);
});

export const DELETE = withAuth(async (req, ctx: AuthenticatedContext) => {
  const uid = ctx.user.internal_uuid;
  const url = new URL(req.url);
  const habitId = url.searchParams.get("habit_id");
  const memberId = url.searchParams.get("member_id");

  const parsed = z.string().uuid().safeParse(habitId);
  if (!parsed.success)
    return Response.json({ error: "INVALID_HABIT_ID" }, { status: 400 });

  const sb = authenticatedClient(ctx.user.supabase_token);

  // Two different gestures share this route: the owner revoking a partner
  // (member_id given), and a member walking away from a habit they were
  // invited to (no member_id — we remove our own row).
  let query = sb.from("habit_shares").delete().eq("habit_id", parsed.data);
  query = memberId
    ? query.eq("owner_id", uid).eq("member_id", memberId)
    : query.eq("member_id", uid);

  const { data, error } = await query.select("habit_id");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return new Response(null, { status: 204 });
});
