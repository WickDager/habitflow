import { NextResponse } from "next/server";
import { validateInitData } from "./validateInitData";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
export type AuthenticatedContext = {
  params: unknown;
  user: {
    internal_uuid: string;
    telegram_id: number;
    supabase_token: string;
  };
};

type Handler = (
  req: Request,
  ctx: AuthenticatedContext,
) => Promise<Response>;

type NextRouteContext = { params: Promise<unknown> };

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

function isMockAuth(initData: string): boolean {
  if (!isDev()) return false;
  const mockData = process.env.NEXT_PUBLIC_MOCK_INIT_DATA;
  if (!mockData) return false;
  return initData === mockData;
}

export function withAuth(handler: Handler) {
  return async (req: Request, ctx: NextRouteContext) => {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json(
        { error: "SUPABASE_JWT_SECRET is not set" },
        { status: 500 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_SUPABASE_URL is not set" },
        { status: 500 },
      );
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not set" },
        { status: 500 },
      );
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    try {
      const initData = req.headers.get("x-telegram-init-data");
      if (!initData)
        return NextResponse.json(
          { error: "Missing init data" },
          { status: 401 },
        );

      let telegramUser: {
        id: number;
        first_name: string;
        username?: string;
        language_code?: string;
      };

      if (isMockAuth(initData)) {
        telegramUser = {
          id: 1234567,
          first_name: "LocalDev",
          language_code: "en",
        };
      } else {
        if (!botToken)
          return NextResponse.json(
            { error: "Server configuration error" },
            { status: 500 },
          );

        const { isValid, user } = validateInitData(initData, botToken);
        if (!isValid || !user)
          return NextResponse.json(
            { error: "Invalid init data" },
            { status: 401 },
          );
        telegramUser = user;
      }

      const { ratelimit } = await import("./rateLimit");
      const { success } = await ratelimit.limit(telegramUser.id.toString());
      if (!success)
        return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

      const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
      const { data: dbUser, error: upsertError } = await adminSupabase
        .from("users")
        .upsert(
          {
            telegram_id: telegramUser.id,
            first_name: telegramUser.first_name,
            username: telegramUser.username,
            language_code: telegramUser.language_code || "en",
          },
          { onConflict: "telegram_id" },
        )
        .select("id")
        .single();

      if (upsertError || !dbUser)
        return NextResponse.json({ error: "DB Sync Error" }, { status: 500 });

      const customJwt = jwt.sign(
        {
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 60 * 60,
          sub: dbUser.id,
          role: "authenticated",
        },
        jwtSecret,
      );

      return await handler(req, {
        params: ctx.params,
        user: {
          internal_uuid: dbUser.id,
          telegram_id: telegramUser.id,
          supabase_token: customJwt,
        },
      });
    } catch {
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
