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
      };
      habit_streaks: {
        Row: {
          habit_id: string;
          user_id: string;
          total_completions: number;
          last_completed: string;
        };
        Insert: {
          habit_id: string;
          user_id: string;
          total_completions?: number;
          last_completed?: string;
        };
        Update: {
          habit_id?: string;
          user_id?: string;
          total_completions?: number;
          last_completed?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
