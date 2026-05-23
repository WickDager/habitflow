import { serverClient } from "@/lib/supabase";
import {
  sendMessage,
  sendMiniAppButton,
  answerCallbackQuery,
} from "@/lib/telegram";
import { en } from "@/lib/i18n/en";
import { ru } from "@/lib/i18n/ru";

function botT(langCode: string | undefined) {
  const t = (langCode === "ru" || langCode === "uk" || langCode === "be") ? ru : en;
  return t;
}

export async function GET() {
  const missing: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME) missing.push("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME");
  if (!process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME) missing.push("NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME");

  return Response.json({
    ok: missing.length === 0,
    missing: missing.length > 0 ? missing : undefined,
  });
}

export async function POST(request: Request) {
  try {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET)
      return new Response("Unauthorized", { status: 401 });

  const update = await request.json();

  if (update.message?.text === "/start") {
    const msg = update.message;
    const chatId = msg.chat.id;
    const t = botT(msg.from?.language_code);

    const sb = serverClient();
    await sb.from("users").upsert(
      {
        telegram_id: msg.from.id,
        first_name: msg.from.first_name,
        username: msg.from.username,
        chat_id: chatId,
        language_code: msg.from.language_code || "en",
      },
      { onConflict: "telegram_id" }
    );

    try {
      await sendMiniAppButton(chatId, t.botWelcome, t.botOpenApp);
    } catch (e) {
      console.error("sendMiniAppButton failed:", e);
      await sendMessage(chatId, t.botWelcome + "\n\n" + "https://habitflow-pi-ten.vercel.app");
    }

    return Response.json({ ok: true });
  }

  if (update.message?.text === "/settings") {
    const chatId = update.message.chat.id;
    const t = botT(update.message.from?.language_code);
    await sendMessage(chatId, t.botReminderSettings, {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: t.botEnableReminders, callback_data: "reminder_on" },
            { text: t.botDisableReminders, callback_data: "reminder_off" },
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
  } catch (err) {
    console.error("Bot error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 200 }
    );
  }
}
