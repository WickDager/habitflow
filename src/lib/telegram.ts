const TG_API = "https://api.telegram.org/bot";

async function tgFetch(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const res = await fetch(`${TG_API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1000));
    return tgFetch(method, body);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram API error: ${json.description}`);
  return json;
}

export async function sendMessage(
  chatId: number,
  text: string,
  options?: { replyMarkup?: unknown; parseMode?: "HTML" | "MarkdownV2" }
) {
  return tgFetch("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode ?? "HTML",
    ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function sendMiniAppButton(
  chatId: number,
  text: string,
  buttonLabel: string,
  appUrl: string
) {
  return sendMessage(chatId, text, {
    parseMode: "HTML",
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: buttonLabel,
            web_app: { url: appUrl },
          },
        ],
      ],
    },
  });
}

export async function setMyCommands() {
  return tgFetch("setMyCommands", {
    commands: [
      { command: "start", description: "Open HabitFlow" },
      { command: "settings", description: "Manage reminders" },
    ],
  });
}

export async function setWebhook(url: string, secretToken: string) {
  return tgFetch("setWebhook", {
    url,
    secret_token: secretToken,
  });
}

export async function answerCallbackQuery(callbackQueryId: string) {
  return tgFetch("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
  });
}
