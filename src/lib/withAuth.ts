import { validateInitData, type TelegramUser } from "./validateInitData";
import { ratelimit } from "./rateLimit";

export async function withAuth(
  request: Request,
  handler: (req: Request, user: TelegramUser) => Promise<Response>
): Promise<Response> {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    if (!initData)
      return Response.json({ error: "MISSING_INIT_DATA" }, { status: 401 });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken)
      return Response.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 });

    const user = validateInitData(initData, botToken);

    const { success } = await ratelimit.limit(user.id.toString());
    if (!success)
      return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

    return handler(request, user);
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_INIT_DATA")
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (err instanceof Error && err.message === "INIT_DATA_EXPIRED")
      return Response.json({ error: "INIT_DATA_EXPIRED" }, { status: 401 });
    console.error("withAuth error:", err);
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
