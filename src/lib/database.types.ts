// Generated types from Supabase.
// Run: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
//
// Hand-extended for the v4 migration (supabase-migration-v4.sql). If you
// regenerate this file from the dashboard, the v4 columns/tables below will
// come back automatically once that migration has been applied.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** A sub-item of a todo. Stored in todos.subtasks (jsonb array). */
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

/** Recurrence rule for a todo. Stored in todos.recurrence (jsonb). */
export interface Recurrence {
  freq: "daily" | "weekly" | "monthly";
  /** 0=Sunday .. 6=Saturday. Only meaningful when freq = "weekly". */
  byday?: number[];
  /** Day of month, 1-31. Only meaningful when freq = "monthly". */
  bymonthday?: number;
}

/** Per-kind notification toggles. Stored in users.reminder_kinds (jsonb). */
export interface ReminderKinds {
  morning?: boolean;
  nudge?: boolean;
  evening?: boolean;
  weekly?: boolean;
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          telegram_id: number;
          first_name: string;
          username: string | null;
          language_code: string | null;
          chat_id: number | null;
          timezone: string;
          reminder_enabled: boolean;
          reminder_hour: number;
          quiet_hours_start: number;
          quiet_hours_end: number;
          max_daily_messages: number;
          reminder_kinds: ReminderKinds;
          morning_hour: number;
          evening_hour: number;
          streak_freezes: number;
          freeze_month: string | null;
          last_active_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          telegram_id: number;
          first_name: string;
          username?: string | null;
          language_code?: string | null;
          chat_id?: number | null;
          timezone?: string;
          reminder_enabled?: boolean;
          reminder_hour?: number;
          quiet_hours_start?: number;
          quiet_hours_end?: number;
          max_daily_messages?: number;
          reminder_kinds?: ReminderKinds;
          morning_hour?: number;
          evening_hour?: number;
          streak_freezes?: number;
          freeze_month?: string | null;
          last_active_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          telegram_id?: number;
          first_name?: string;
          username?: string | null;
          language_code?: string | null;
          chat_id?: number | null;
          timezone?: string;
          reminder_enabled?: boolean;
          reminder_hour?: number;
          quiet_hours_start?: number;
          quiet_hours_end?: number;
          max_daily_messages?: number;
          reminder_kinds?: ReminderKinds;
          morning_hour?: number;
          evening_hour?: number;
          streak_freezes?: number;
          freeze_month?: string | null;
          last_active_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      habits: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          icon: string;
          sort_order: number;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          icon?: string;
          sort_order?: number;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          icon?: string;
          sort_order?: number;
          archived_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      checkins: {
        Row: {
          id: string;
          user_id: string;
          habit_id: string;
          date: string;
          completed: boolean;
          mood: number | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          habit_id: string;
          date: string;
          completed?: boolean;
          mood?: number | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          habit_id?: string;
          date?: string;
          completed?: boolean;
          mood?: number | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      habit_streaks: {
        Row: {
          habit_id: string;
          user_id: string;
          current_streak: number;
          total_completions: number;
          last_completed: string | null;
        };
        Insert: {
          habit_id: string;
          user_id: string;
          current_streak?: number;
          total_completions?: number;
          last_completed?: string | null;
        };
        Update: {
          habit_id?: string;
          user_id?: string;
          current_streak?: number;
          total_completions?: number;
          last_completed?: string | null;
        };
        Relationships: [];
      };
      todos: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          due_date: string | null;
          due_time: string | null;
          is_completed: boolean;
          priority: number;
          notes: string | null;
          rolled_over_count: number;
          recurrence: Recurrence | null;
          subtasks: Subtask[];
          sort_order: number;
          completed_at: string | null;
          parent_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          due_date?: string | null;
          due_time?: string | null;
          is_completed?: boolean;
          priority?: number;
          notes?: string | null;
          rolled_over_count?: number;
          recurrence?: Recurrence | null;
          subtasks?: Subtask[];
          sort_order?: number;
          completed_at?: string | null;
          parent_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          due_date?: string | null;
          due_time?: string | null;
          is_completed?: boolean;
          priority?: number;
          notes?: string | null;
          rolled_over_count?: number;
          recurrence?: Recurrence | null;
          subtasks?: Subtask[];
          sort_order?: number;
          completed_at?: string | null;
          parent_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      reminder_log: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          local_date: string;
          dedupe_key: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: string;
          local_date: string;
          dedupe_key: string;
          sent_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          local_date?: string;
          dedupe_key?: string;
          sent_at?: string;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          color?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      todo_tags: {
        Row: {
          todo_id: string;
          tag_id: string;
        };
        Insert: {
          todo_id: string;
          tag_id: string;
        };
        Update: {
          todo_id?: string;
          tag_id?: string;
        };
        Relationships: [];
      };
      daily_focus: {
        Row: {
          user_id: string;
          habit_id: string;
          date: string;
        };
        Insert: {
          user_id: string;
          habit_id: string;
          date: string;
        };
        Update: {
          user_id?: string;
          habit_id?: string;
          date?: string;
        };
        Relationships: [];
      };
      routines: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          icon: string | null;
          days: number[];
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          icon?: string | null;
          days?: number[];
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          icon?: string | null;
          days?: number[];
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      routine_items: {
        Row: {
          routine_id: string;
          habit_id: string;
          sort_order: number;
        };
        Insert: {
          routine_id: string;
          habit_id: string;
          sort_order?: number;
        };
        Update: {
          routine_id?: string;
          habit_id?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      habit_shares: {
        Row: {
          habit_id: string;
          owner_id: string;
          member_id: string;
          status: string;
          created_at: string;
        };
        Insert: {
          habit_id: string;
          owner_id: string;
          member_id: string;
          status?: string;
          created_at?: string;
        };
        Update: {
          habit_id?: string;
          owner_id?: string;
          member_id?: string;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

// ── Row aliases ──
// Defined here, not in withAuth.ts, so client code can import row shapes
// without pulling in Next's server-only modules.
export type Tables = Database["public"]["Tables"];
export type UserRow = Tables["users"]["Row"];
export type HabitRow = Tables["habits"]["Row"];
export type CheckinRow = Tables["checkins"]["Row"];
export type HabitStreakRow = Tables["habit_streaks"]["Row"];
export type TodoRow = Tables["todos"]["Row"];
export type TagRow = Tables["tags"]["Row"];
export type RoutineRow = Tables["routines"]["Row"];
export type RoutineItemRow = Tables["routine_items"]["Row"];
export type DailyFocusRow = Tables["daily_focus"]["Row"];
export type HabitShareRow = Tables["habit_shares"]["Row"];
