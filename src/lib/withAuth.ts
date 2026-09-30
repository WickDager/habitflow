import { NextResponse } from "next/server";
import { validateInitData } from "./validateInitData";
import { createClient } from "@supabase/supabase-js";
import { mintSession, verifySession, SESSION_HEADER } from "./session";
import type { UserRow } from "./database.types";
import jwt from "jsonwebtoken";

export type { UserRow };

export type AuthenticatedContext = {
  params: unknown;
  user: {
    internal_uuid: string;
    telegram_id: number;
    supabase_token: string;
  };
  /** The caller's full users row: timezone, chat_id, reminder preferences. */
  profile: UserRow;
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

/**
 * The x-timezone header is just a header — anyone can send anything — and its
 * value is written straight into users.timezone, which the streak trigger feeds
 * to Postgres' `at time zone`. An unresolvable name there would raise inside an
 * AFTER trigger and make every check-in insert for that user fail. The SQL side
 * also falls back defensively; this stops the bad value being stored at all.
 */
function sanitizeTimezone(value: string | null): string | null {
  if (!value || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
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
      const sessionToken = req.headers.get(SESSION_HEADER);

      let telegramUser: {
        id: number;
        first_name: string;
        username?: string;
        language_code?: string;
      } | null = null;

      /** Set when the request was authenticated by a session token instead. */
      let sessionUserId: string | null = null;
      /** True when this request presented init data we can re-sign a session from. */
      let authenticatedByInitData = false;

      if (initData && isMockAuth(initData)) {
        telegramUser = {
          id: 1234567,
          first_name: "LocalDev",
          language_code: "en",
        };
        authenticatedByInitData = true;
      } else if (initData) {
        if (!botToken)
          return NextResponse.json(
            { error: "Server configuration error" },
            { status: 500 },
          );

        const { isValid, user, reason } = validateInitData(initData, botToken);
        if (isValid && user) {
          telegramUser = user;
          authenticatedByInitData = true;
        } else if (reason !== "EXPIRED") {
          // A genuinely bad HMAC is a hard failure: a session token must not
          // rescue a forged or malformed payload.
          console.error("validateInitData failed:", {
            reason,
            initDataLen: initData.length,
            hasHash: initData.includes("hash="),
            params: [...new URLSearchParams(initData).keys()],
          });
          return NextResponse.json(
            { error: "Invalid init data" },
            { status: 401 },
          );
        }
        // EXPIRED falls through: the HMAC was valid, it is only old. The
        // session token below can still carry the request.
      }

      // Fall back to a session token when init data is missing or old. This is
      // the Telegram Web case: the URL fragment never refreshes.
      if (!telegramUser) {
        const session = sessionToken ? verifySession(sessionToken) : null;
        if (session) sessionUserId = session.userId;
      }

      if (!telegramUser && !sessionUserId) {
        return NextResponse.json(
          {
            error: initData ? "INIT_DATA_EXPIRED" : "Missing init data",
            // Tells the client to reopen from the bot rather than retry.
            reopen: initData ? true : undefined,
          },
          { status: 401 },
        );
      }

      const rateKey = telegramUser
        ? telegramUser.id.toString()
        : `session:${sessionUserId}`;
      const { ratelimit } = await import("./rateLimit");
      const { success, degraded } = await ratelimit.limit(rateKey);
      if (degraded) console.error("rate limiter degraded for", rateKey);
      if (!success)
        return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

      const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

      let profile: UserRow | null = null;

      if (telegramUser) {
        // The device's timezone is authoritative: it is the most accurate
        // signal available and it follows the user when they travel.
        const tzHeader = sanitizeTimezone(req.headers.get("x-timezone"));
        const { data, error } = await adminSupabase
          .from("users")
          .upsert(
            {
              telegram_id: telegramUser.id,
              first_name: telegramUser.first_name,
              username: telegramUser.username,
              language_code: telegramUser.language_code || "en",
              last_active_at: new Date().toISOString(),
              ...(tzHeader ? { timezone: tzHeader } : {}),
            },
            { onConflict: "telegram_id" },
          )
          .select("*")
          .single();
        if (error || !data)
          return NextResponse.json({ error: "DB Sync Error" }, { status: 500 });
        profile = data as UserRow;
      } else {
        const { data, error } = await adminSupabase
          .from("users")
          .select("*")
          .eq("id", sessionUserId!)
          .single();
        if (error || !data)
          return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        profile = data as UserRow;
      }

      const customJwt = jwt.sign(
        {
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 60 * 60,
          sub: profile.id,
          role: "authenticated",
        },
        jwtSecret,
      );

      const res = await handler(req, {
        params: ctx.params,
        user: {
          internal_uuid: profile.id,
          telegram_id: profile.telegram_id,
          supabase_token: customJwt,
        },
        profile,
      });

      // Hand back a refreshed session token on init-data requests so the
      // client's 30-day window slides forward as the app is used. Best effort:
      // some Response objects have immutable headers.
      if (authenticatedByInitData) {
        const fresh = mintSession(profile.id, profile.telegram_id);
        if (fresh) {
          try {
            res.headers.set(SESSION_HEADER, fresh);
          } catch {
            /* immutable headers; the client keeps its existing token */
          }
        }
      }

      return res;
    } catch (err) {
      console.error("withAuth threw:", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
