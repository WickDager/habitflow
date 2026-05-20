import { serverClient } from "@/lib/supabase";
import { sendMiniAppButton } from "@/lib/telegram";

export async function GET(request: Request) {
  if (
    request.headers.get("authorization") !==
    "Bearer " + process.env.CRON_SECRET
  )
    return new Response("Unauthorized", { status: 401 });

  const sb = serverClient();

  const { data: users } = await sb
    .from("users")
    .select("id, telegram_id, chat_id, timezone, reminder_hour")
    .eq("reminder_enabled", true)
    .not("chat_id", "is", null);

  if (!users || users.length === 0)
    return Response.json({ reminded: 0 });

  const localHour = new Date().getUTCHours();
  const eligible = users.filter((u) => u.reminder_hour === localHour);

  if (eligible.length === 0)
    return Response.json({ reminded: 0 });

  const today = new Date().toISOString().slice(0, 10);

  let reminded = 0;
  for (let i = 0; i < eligible.length; i++) {
    const u = eligible[i];

    const { data: checkins } = await sb
      .from("checkins")
      .select("id", { count: "exact", head: true })
      .eq("user_id", u.id)
      .eq("date", today)
      .eq("completed", true);

    if (checkins && checkins.length > 0) continue;

    const appUrl = `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}/${process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME}`;

    try {
      await sendMiniAppButton(
        u.chat_id!,
        "You haven't checked in today. Tap below to log your habits.",
        "Log habits",
        appUrl
      );
      reminded++;
    } catch {
      // skip user on failure
    }

    if (i > 0 && i % 25 === 0)
      await new Promise((r) => setTimeout(r, 1000));
    else if (reminded > 0)
      await new Promise((r) => setTimeout(r, 35));
  }

  return Response.json({ reminded });
}
