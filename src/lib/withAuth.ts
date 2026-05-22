import { NextResponse } from "next/server";
import { validateInitData } from "./validateInitData";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import { ratelimit } from "./rateLimit";

export type AuthenticatedContext = {
  params: any;
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
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      "SUPABASE_JWT_SECRET is not set. Add it from Supabase dashboard > Project Settings > API > JWT Secret."
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken && !isDev()) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  return async (req: Request, ctx: any) => {
    try {
      const initData = req.headers.get("x-telegram-init-data");
      if (!initData)
        return NextResponse.json(
          { error: "Missing init data" },
          { status: 401 },
        );

      let telegramUser;

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
            username: (telegramUser as any).username,
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
        ...ctx,
        user: {
          internal_uuid: dbUser.id,
          telegram_id: telegramUser.id,
          supabase_token: customJwt,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
