// Generated types from Supabase.
// Run: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
          last_completed: string;
        };
        Insert: {
          habit_id: string;
          user_id: string;
          current_streak?: number;
          last_completed?: string;
        };
        Update: {
          habit_id?: string;
          user_id?: string;
          current_streak?: number;
          last_completed?: string;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          due_date?: string | null;
          due_time?: string | null;
          is_completed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          due_date?: string | null;
          due_time?: string | null;
          is_completed?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
