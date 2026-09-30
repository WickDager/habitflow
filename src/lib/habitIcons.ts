/**
 * The habit icon set, grouped for the picker.
 *
 * This replaces the same ten icons that used to be hardcoded twice — once in
 * CreateModal, once in EditHabitSheet — where they could drift apart. One
 * source of truth, read by every surface that picks an icon.
 *
 * ── ICON FORM ────────────────────────────────────────────────────────────
 * Icons are validated server-side by `HabitSchema` in src/lib/schemas.ts:
 *
 *   icon: z.string().emoji().max(8)
 *
 * Zod's `.max()` counts UTF-16 code units. Any glyph above U+FFFF is already a
 * surrogate PAIR — 2 units before modifiers — so a colour-form emoji carrying
 * U+FE0F is 3:
 *
 *   "🏋️"  U+1F3CB             -> 2 units
 *   "🏋️" U+1F3CB U+FE0F  -> 3 units
 *
 * The cap used to be 2, which silently rejected every 3-unit icon: the picker
 * offered them and the route answered 400. That is why the palette below uses
 * the colour forms (they read correctly in the grid) and why the cap is 8 now —
 * enough for a glyph plus a variation selector, still far below a sentence.
 *
 * The set stays deliberately to single glyphs (+ optional U+FE0F). No skin
 * tones, ZWJ sequences (👨👩👧, 👨💻) or flags: they render inconsistently
 * across Telegram's WebViews and make the grid look ragged.
 *
 * To re-check the file against the real schema after an edit, run every icon
 * through `z.string().emoji().max(8)` with the repo's own zod (v4).
 */

export interface HabitIconGroup {
  /** Stable id: React keys, and the suffix of each group's aria-labelledby. */
  id: string;
  /**
   * i18n key for the group heading. Never an English string — the heading is
   * rendered through `t()`, and the keys are declared in src/lib/i18n/en.ts.
   */
  labelKey: string;
  icons: readonly string[];
}

export const HABIT_ICON_GROUPS: readonly HabitIconGroup[] = [
  {
    id: "move",
    labelKey: "iconGroupMove",
    icons: ["🏃", "🚶", "🚴", "🏋️", "💪", "🧘", "🤸", "🏊", "🥾"],
  },
  {
    id: "health",
    labelKey: "iconGroupHealth",
    icons: ["💧", "🥗", "🍎", "💊", "😴", "💤", "🦷", "🧴"],
  },
  {
    id: "mind",
    labelKey: "iconGroupMind",
    icons: ["📚", "✍️", "🧠", "🎯", "🎨", "🎵", "🗣️", "📝"],
  },
  {
    id: "home",
    labelKey: "iconGroupHome",
    icons: ["🧹", "🧺", "🪴", "🐕", "🛒", "🍳", "🗑️", "🧼"],
  },
  {
    id: "work",
    labelKey: "iconGroupWork",
    icons: ["💻", "📅", "✉️", "📈", "🧾", "⏰", "🔧", "🗂"],
  },
  {
    id: "social",
    labelKey: "iconGroupSocial",
    // ❤️ is BMP (U+2764) + selector = 2 units, so it stays as the sketch wrote it.
    icons: ["👥", "💬", "❤️", "📞", "🤝", "🎁", "🎉", "👋"],
  },
];

/** Every icon in the set, in group order. */
export const HABIT_ICONS: readonly string[] = HABIT_ICON_GROUPS.flatMap(
  (group) => group.icons
);

/**
 * Icon for a new habit. Kept as 🏃 because that is what CreateModal defaulted
 * to before the set was extracted — a new habit looks the same as it used to.
 */
export const DEFAULT_HABIT_ICON = "🏃";

/** Set lookup; module scope so the picker's per-render check stays O(1). */
const ICON_SET: ReadonlySet<string> = new Set(HABIT_ICONS);

/**
 * Whether an icon belongs to the set.
 *
 * The picker needs this to answer "is the habit's current icon still one we
 * offer?". Habits saved before this set existed — or written by the bot — can
 * hold any emoji, and those must never be silently swapped for a default.
 */
export function isHabitIcon(icon: string): boolean {
  return ICON_SET.has(icon);
}
