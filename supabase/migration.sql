-- HabitFlow Schema Migration
-- Run in Supabase SQL Editor

-- 1. Core tables
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint UNIQUE NOT NULL,
  first_name text NOT NULL,
  username text,
  language_code text DEFAULT 'en',
  chat_id bigint,
  timezone text DEFAULT 'UTC',
  reminder_enabled boolean DEFAULT true,
  reminder_hour smallint DEFAULT 21,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text DEFAULT '✅',
  sort_order smallint DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date date NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  mood smallint CHECK (mood IN (1, 2, 3)),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (habit_id, date)
);

-- 2. Performance indexes
CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_habits_user_active ON habits(user_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- 3. Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (telegram_id = (current_setting('app.telegram_id', true))::bigint);
CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (telegram_id = (current_setting('app.telegram_id', true))::bigint);

CREATE POLICY "habits_all_own" ON habits FOR ALL
  USING (user_id = (
    SELECT id FROM users
    WHERE telegram_id = (current_setting('app.telegram_id', true))::bigint
  ));

CREATE POLICY "checkins_all_own" ON checkins FOR ALL
  USING (user_id = (
    SELECT id FROM users
    WHERE telegram_id = (current_setting('app.telegram_id', true))::bigint
  ));

-- 5. Habit limit trigger
CREATE OR REPLACE FUNCTION check_habit_limit() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM habits WHERE user_id = NEW.user_id
      AND archived_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'HABIT_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS habit_limit_trigger ON habits;
CREATE TRIGGER habit_limit_trigger BEFORE INSERT ON habits
  FOR EACH ROW EXECUTE FUNCTION check_habit_limit();

-- 6. Habit streaks materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS habit_streaks AS
  SELECT
    c.habit_id,
    c.user_id,
    COUNT(*) FILTER (WHERE c.completed) AS total_completions,
    MAX(c.date) AS last_completed
  FROM checkins c
  GROUP BY c.habit_id, c.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_streaks_unique
  ON habit_streaks(habit_id, user_id);
