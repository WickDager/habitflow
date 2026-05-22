# HabitFlow

A Telegram Mini App for tracking daily habits in under 10 seconds. Built with Next.js 16 (App Router), Supabase, and the Telegram WebApp API.

## Architecture

- **Auth** — Custom JWT minted from Telegram init data, validated via HMAC. Supabase RLS enforces `auth.uid() = user_id` on every query.
- **UI** — 3-tab layout (Today / Tasks / Stats), FAB + bottom sheet, optimistic mutations via SWR, Telegram dynamic theming, haptic feedback.
- **API** — 9 route handlers under `/api/`, all using JWT-authenticated Supabase clients (service_role key used only in `withAuth.ts` for user upserts).
- **i18n** — English and Russian, auto-detected from Telegram `language_code`.

## Quick Start

```bash
npm install
cp .env.example .env.local   # then fill in your keys (see .env.example)
npm run dev                   # http://localhost:3000
```

Dev mode auto-injects mock Telegram data — no Telegram account needed for local development. Set `NEXT_PUBLIC_MOCK_INIT_DATA` in `.env.local` to any string to enable this.

## Environment Variables

| Variable | Source |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | @BotFather |
| `NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME` | @BotFather `/newapp` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Settings |
| `UPSTASH_REDIS_REST_URL` | Upstash → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → REST API |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 16` |
| `NEXT_PUBLIC_MOCK_INIT_DATA` | Any string (dev only) |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── bot/          — Telegram webhook handler
│   │   ├── checkins/     — GET (list), POST (bulk upsert)
│   │   ├── checkins/stats/ — GET streaks, moods, weekly
│   │   ├── cron/         — Reminder cron job
│   │   ├── habits/       — GET, POST
│   │   ├── habits/[id]/  — PATCH, DELETE (soft-delete)
│   │   ├── todos/        — GET, POST
│   │   ├── todos/[id]/   — PATCH, DELETE
│   │   └── users/        — POST (upsert)
│   ├── layout.tsx
│   ├── page.tsx          — 3-tab shell
│   └── globals.css
├── components/
│   ├── CreateModal.tsx   — Bottom sheet (habit + task forms)
│   ├── FAB.tsx           — Floating action button
│   ├── HabitSkeleton.tsx — Loading skeleton
│   ├── LanguageSwitcher.tsx
│   ├── StatsView.tsx     — Streaks, mood sparkline, weekly progress
│   ├── TasksView.tsx     — Todo list with swipe-to-delete
│   ├── TodayView.tsx     — Habit checklist, mood picker
│   └── TelegramProvider.tsx
└── lib/
    ├── apiFetch.ts       — Fetch wrapper with init data injection
    ├── haptics.ts        — Telegram haptic feedback helpers
    ├── i18n/             — en.ts, ru.ts, LanguageProvider
    ├── offlineStore.ts   — IndexedDB pending checkins queue
    ├── rateLimit.ts      — Upstash Redis rate limiter (30 req/min)
    ├── schemas.ts        — Zod schemas (habits, checkins, todos)
    ├── supabase.ts       — serverClient, authenticatedClient
    ├── telegram.ts       — Bot API helpers
    ├── validateInitData.ts — Telegram HMAC validation
    └── withAuth.ts       — JWT auth middleware
```

## Auth Flow

1. Client sends `x-telegram-init-data` header on every request
2. `withAuth.ts` validates HMAC (production) or mock bypass (dev)
3. User upserted via service_role → custom JWT minted with `sub=user.uuid`
4. Route handlers use `authenticatedClient(token)` → Supabase resolves `auth.uid()` from JWT
5. RLS policies enforce `auth.uid() = user_id` on all tables

## Database

Run `supabase-schema.sql` in the Supabase SQL Editor. Creates:

- `users` — Telegram accounts
- `habits` — User-created habits (max 20 active, enforced by trigger)
- `checkins` — Daily completions with mood tracking
- `habit_streaks` — Auto-updated via trigger on checkin insert
- `todos` — One-off tasks with optional due dates

All tables have RLS policies using `auth.uid() = user_id`.

## Deploy

Push to GitHub, connect to Vercel, add all environment variables, then:

```bash
# Set the webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-app.vercel.app/api/bot","secret_token":"<WEBHOOK_SECRET>"}'

# Set the chat menu button
curl -X POST "https://api.telegram.org/bot<TOKEN>/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{"menu_button":{"type":"web_app","text":"Open HabitFlow","web_app":{"url":"https://your-app.vercel.app"}}}'
```

See [TODO.md](../TODO.md) for the full step-by-step setup guide.
