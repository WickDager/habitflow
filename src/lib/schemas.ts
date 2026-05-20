import { z } from "zod";

export const CheckinSchema = z.object({
  habit_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.boolean(),
  mood: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  notes: z.string().max(280).optional(),
});

export const HabitSchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().emoji().max(2),
});

export const BulkCheckinSchema = z.object({
  checkins: z.array(CheckinSchema).min(1).max(20),
});
