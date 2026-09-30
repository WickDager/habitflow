import { en } from "./en";
import { ru } from "./ru";

/**
 * The single rule for picking a dictionary from a Telegram `language_code`.
 *
 * This was duplicated in five places, and the copies drifted: the accountability
 * invite in `src/app/api/shares/route.ts` tested only for "ru", so Ukrainian and
 * Belarusian speakers — who get Russian everywhere else in the app — received an
 * English invite. The other copies still inline the rule; they should migrate
 * here rather than be kept in sync by hand.
 */
export function dictionaryFor(
  languageCode: string | null | undefined
): Record<string, string> {
  return languageCode === "ru" ||
    languageCode === "uk" ||
    languageCode === "be"
    ? (ru as Record<string, string>)
    : (en as unknown as Record<string, string>);
}
