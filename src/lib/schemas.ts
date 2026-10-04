import { z } from "zod";

export const CheckinSchema = z.object({
  habit_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.boolean(),
  // nullish, for the same reason as the todo fields below: both columns are
  // nullable in the database, and `.optional()` accepts only undefined. No
  // caller sends null today, but adding a "clear my mood" affordance would
  // otherwise turn into a 400 — which is exactly how the todo version shipped.
  mood: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
  notes: z.string().max(280).nullish(),
});

export const HabitSchema = z.object({
  name: z.string().min(1).max(50),
  // max(8), not max(2). Zod counts UTF-16 units, so a single emoji that carries
  // a variation selector (🏋️ U+1F3CB U+FE0F) is 3 units and was rejected — the
  // client would have offered icons the server refused with a 400. 8 still
  // bounds the field (a sentence is ~30 units) while allowing colour forms and
  // short ZWJ sequences.
  icon: z.string().emoji().max(8),
});

export const BulkCheckinSchema = z.object({
  checkins: z.array(CheckinSchema).min(1).max(20),
});

/** A row of todos.subtasks (jsonb array). Mirrors the Subtask type. */
export const SubtaskSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  done: z.boolean(),
});

/** todos.recurrence (jsonb). Mirrors the Recurrence type. */
export const RecurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  /** 0=Sunday .. 6=Saturday; only meaningful for weekly. */
  byday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** Day of month 1-31; only meaningful for monthly. */
  bymonthday: z.number().int().min(1).max(31).optional(),
});

/**
 * Tag names arrive from `#tags` in free text, from the tag picker, and from
 * the bot. Normalised to lower case by the callers so "Home" and "home" are
 * one tag — the tags table is unique on (user_id, name).
 */
export const TagNameSchema = z.string().trim().min(1).max(30);

/**
 * The stored form of a tag name: lower-cased, no leading '#'.
 *
 * A leading # is how tags are written in a task title, and clients may pass
 * back exactly what the user typed. Normalising here (rather than in a Zod
 * transform) keeps `.partial()` plain and lets the routes guard the
 * empty-after-normalisation case, e.g. a tag of "###".
 */
export function normalizeTagName(name: string): string {
  return name
    .trim()
    .replace(/^#+/, "")
    .trim()
    .toLowerCase();
}

export const TodoSchema = z.object({
  title: z.string().min(1).max(200),
  // nullish, not just optional: the columns are nullable and the edit sheet
  // sends an explicit null to clear a date or time. Plain .optional() accepts
  // only undefined, so every edit that left one of these empty returned 400 —
  // no task without a due date could ever be saved. Keep nullish on every
  // field below whose DB column is nullable.
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  due_time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  is_completed: z.boolean().optional(),
  // smallint 0=none, 1=low, 2=medium, 3=high. Not nullish: the column is
  // NOT NULL with a default, and the list orders by `priority desc`, so the
  // larger number is the more important one.
  priority: z.number().int().min(0).max(3).optional(),
  notes: z.string().max(2000).nullish(),
  subtasks: z.array(SubtaskSchema).max(50).optional(),
  recurrence: RecurrenceSchema.nullish(),
  completed_at: z.string().nullish(),
  // Convenience field, not a column: the route resolves these to rows in
  // `tags` and links them through `todo_tags`.
  tags: z.array(TagNameSchema).max(20).optional(),
});

export const TagSchema = z.object({
  name: TagNameSchema,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});
