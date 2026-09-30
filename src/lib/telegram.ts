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

export async function sendPhotoWithButton(
  chatId: number,
  photoUrl: string,
  caption: string,
  buttonLabel: string
) {
  const productionDomain = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://habitflow-pi-ten.vercel.app";

  const appUrl = productionDomain.replace(/^https?:\/\//, "https://");

  return tgFetch("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: {
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

export async function sendAnimationWithButton(
  chatId: number,
  gifUrl: string,
  caption: string,
  buttonLabel: string
) {
  const productionDomain = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://habitflow-pi-ten.vercel.app";

  const appUrl = productionDomain.replace(/^https?:\/\//, "https://");

  return tgFetch("sendAnimation", {
    chat_id: chatId,
    animation: gifUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: {
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

export async function sendMiniAppButton(
  chatId: number,
  text: string,
  buttonLabel: string
) {
  const productionDomain = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://habitflow-pi-ten.vercel.app";

  const appUrl = productionDomain.replace(/^https?:\/\//, "https://");

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

/**
 * Register the command menu shown in Telegram's UI.
 *
 * This must list every command the bot actually handles — the menu is the only
 * place a user can discover them, so a missing entry means a command that
 * effectively doesn't exist. Keep in sync with `botHelp` in the i18n tables.
 */
export async function setMyCommands() {
  const en = {
    commands: [
      { command: "start", description: "Open HabitFlow" },
      { command: "add", description: "Add a task — /add pay rent tomorrow 9am" },
      { command: "today", description: "Today's plan" },
      { command: "stats", description: "Your streaks and progress" },
      { command: "settings", description: "Manage reminders" },
      { command: "help", description: "What this bot can do" },
    ],
    language_code: "en",
  };
  const ru = {
    commands: [
      { command: "start", description: "Открыть HabitFlow" },
      { command: "add", description: "Добавить задачу — /add оплатить аренду завтра в 9:00" },
      { command: "today", description: "План на сегодня" },
      { command: "stats", description: "Серии и прогресс" },
      { command: "settings", description: "Управление напоминаниями" },
      { command: "help", description: "Что умеет бот" },
    ],
    language_code: "ru",
  };
  await tgFetch("setMyCommands", en);
  await tgFetch("setMyCommands", ru);
}

export async function setWebhook(url: string, secretToken: string) {
  return tgFetch("setWebhook", {
    url,
    secret_token: secretToken,
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  options?: { text?: string; showAlert?: boolean }
) {
  return tgFetch("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(options?.text ? { text: options.text } : {}),
    ...(options?.showAlert ? { show_alert: true } : {}),
  });
}

/**
 * Rewrite an existing message in place — used so a reminder updates itself
 * ("Drink water" → "Drink water ✅") instead of the bot replying again and
 * filling the chat with duplicates.
 */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  options?: { replyMarkup?: unknown }
) {
  return tgFetch("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...(options?.replyMarkup !== undefined
      ? { reply_markup: options.replyMarkup }
      : {}),
  });
}

export async function deleteMessage(chatId: number, messageId: number) {
  return tgFetch("deleteMessage", { chat_id: chatId, message_id: messageId });
}

/**
 * Send a generated PNG (the weekly report card) without needing it hosted
 * anywhere: Bot API accepts multipart/form-data uploads.
 */
export async function sendPhotoBuffer(
  chatId: number,
  png: Uint8Array,
  caption: string,
  options?: { replyMarkup?: unknown }
) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (options?.replyMarkup !== undefined) {
    form.append("reply_markup", JSON.stringify(options.replyMarkup));
  }
  form.append(
    "photo",
    new Blob([png as unknown as BlobPart], { type: "image/png" }),
    "habitflow-week.png"
  );

  const res = await fetch(`${TG_API}${token}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram API error: ${json.description}`);
  return json;
}
