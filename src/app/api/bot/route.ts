import { serverClient } from "@/lib/supabase";
import {
  sendMessage,
  sendMiniAppButton,
  answerCallbackQuery,
} from "@/lib/telegram";

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET)
    return new Response("Unauthorized", { status: 401 });

  const update = await request.json();

  if (update.message?.text === "/start") {
    const msg = update.message;
    const chatId = msg.chat.id;

    const sb = serverClient();
    await sb.from("users").upsert(
      {
        telegram_id: msg.from.id,
        first_name: msg.from.first_name,
        username: msg.from.username,
        chat_id: chatId,
      },
      { onConflict: "telegram_id" }
    );

    const appUrl = `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}/${process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME}`;

    await sendMiniAppButton(
      chatId,
      "Track your daily habits in under 10 seconds.\n\nTap below to open HabitFlow.",
      "Open HabitFlow",
      appUrl
    );

    return Response.json({ ok: true });
  }

  if (update.message?.text === "/settings") {
    const chatId = update.message.chat.id;
    await sendMessage(chatId, "Reminder settings:", {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "Enable reminders", callback_data: "reminder_on" },
            { text: "Disable reminders", callback_data: "reminder_off" },
          ],
        ],
      },
    });
    return Response.json({ ok: true });
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const sb = serverClient();

    if (cq.data === "reminder_on" || cq.data === "reminder_off") {
      await sb
        .from("users")
        .update({ reminder_enabled: cq.data === "reminder_on" })
        .eq("telegram_id", cq.from.id);

      await answerCallbackQuery(cq.id);
      return Response.json({ ok: true });
    }
  }

  return Response.json({ ok: true });
}
