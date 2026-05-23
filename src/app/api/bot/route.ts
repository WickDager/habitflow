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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const testChatId = url.searchParams.get("test_chat_id");

  if (testChatId || url.searchParams.get("auto_test") !== null) {
    let chatId: number;
    if (testChatId) {
      chatId = parseInt(testChatId);
    } else {
      const sb = serverClient();
      const { data: user } = await sb
        .from("users")
        .select("chat_id")
        .not("chat_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (!user?.chat_id) {
        return Response.json({ error: "No user with chat_id found in DB. Send /start to the bot first." });
      }
      chatId = user.chat_id;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const productionDomain = process.env.NEXT_PUBLIC_APP_URL
      ? process.env.NEXT_PUBLIC_APP_URL
      : "https://habitflow-pi-ten.vercel.app";
    const appUrl = productionDomain.replace(/^https?:\/\//, "https://");

    const payload = {
      chat_id: chatId,
      text: "Debug test — web_app button",
      reply_markup: {
        inline_keyboard: [[
          { text: "Open HabitFlow", web_app: { url: appUrl } }
        ]]
      }
    };

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      return Response.json({ chat_id: chatId, appUrl, telegram_response: json });
    } catch (e) {
      return Response.json({ chat_id: chatId, appUrl, error: String(e) });
    }
  }

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
