"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/apiFetch";
import { errorMessage } from "@/lib/errors";
import { haptics } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n";
import { describeDueDate, parseTaskInput } from "@/lib/nlpDate";
import { useToast } from "@/components/Toast";
import type { TagRow } from "@/lib/database.types";
import { TagPicker } from "./TagPicker";
import styles from "./QuickAddBar.module.css";

/** Indexed by priority 0-3. */
const PRIORITY_KEYS = [
  "priorityNone",
  "priorityLow",
  "priorityMedium",
  "priorityHigh",
];

/**
 * Persistent task entry above the list.
 *
 * The parse preview runs on every keystroke and is shown *before* submit, so
 * "pay rent !1 tomorrow 9am #home" is visibly understood as title + date +
 * time + priority + tags rather than saved as a literal sentence.
 */
export function QuickAddBar() {
  const { t, lang } = useLanguage();
  const dateI18n = { t, locale: lang === "ru" ? "ru-RU" : "en-GB" };
  const { toast } = useToast();
  const { mutate } = useSWRConfig();

  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);

  const { data: tags } = useSWR<TagRow[]>("/api/tags", apiFetch, {
    fallbackData: [],
  });

  const preview = useMemo(() => {
    const trimmed = text.trim();
    // Empty input is not an error — there is simply nothing to preview.
    return trimmed ? parseTaskInput(trimmed) : null;
  }, [text]);

  const handleTextChange = (value: string) => {
    setText(value);
    // Typing #home selects it. Seeding happens here rather than in an effect
    // so a tag the user has since deselected stays deselected until the text
    // changes again.
    const parsed = parseTaskInput(value).tags ?? [];
    const added = parsed.filter((name) => !picked.includes(name));
    if (added.length) setPicked((prev) => [...new Set([...prev, ...added])]);
  };

  const toggleTag = (name: string) => {
    setPicked((prev) =>
      prev.includes(name) ? prev.filter((tag) => tag !== name) : [...prev, name],
    );
  };

  const handleCreateTag = async (name: string) => {
    try {
      await apiFetch("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await mutate("/api/tags");
      // Creating a tag selects it: that is why the user typed it.
      setPicked((prev) => (prev.includes(name) ? prev : [...prev, name]));
    } catch (err) {
      toast(errorMessage(err, t), { kind: "error" });
    }
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;

    const parsed = parseTaskInput(trimmed);
    if (!parsed.title) return;

    setSaving(true);
    try {
      const body: Record<string, unknown> = { title: parsed.title };
      if (parsed.dueDate) body.due_date = parsed.dueDate;
      if (parsed.dueTime) body.due_time = parsed.dueTime;
      if (parsed.priority !== undefined) body.priority = parsed.priority;
      if (picked.length) body.tags = picked;

      await apiFetch("/api/todos", {
        method: "POST",
        body: JSON.stringify(body),
      });

      haptics.success();
      setText("");
      setPicked([]);
      toast(t("taskAdded"), { kind: "success" });
      await mutate(
        (key) => typeof key === "string" && key.startsWith("/api/todos"),
      );
    } catch (err) {
      haptics.error();
      toast(errorMessage(err, t), { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const showPicker = focused || text.trim().length > 0;

  return (
    <form
      className={styles.bar}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // Keep the picker open while focus moves between fields inside the bar.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder={t("quickAddPlaceholder")}
          aria-label={t("quickAddPlaceholder")}
          maxLength={200}
          // Arabic and Cyrillic titles pick their own direction.
          dir="auto"
          enterKeyHint="done"
        />
        <button
          type="submit"
          className={styles.addBtn}
          disabled={saving || !text.trim()}
        >
          {t("add")}
        </button>
      </div>

      {preview ? (
        <div className={styles.preview} aria-live="polite">
          <span className={styles.previewTitle}>{preview.title}</span>
          {preview.dueDate ? (
            <span className={styles.badge}>
              📅 {describeDueDate(preview.dueDate, new Date(), dateI18n)}
            </span>
          ) : null}
          {preview.dueTime ? (
            <span className={styles.badge}>🕒 {preview.dueTime}</span>
          ) : null}
          {preview.priority ? (
            <span className={styles.badge} data-priority={preview.priority}>
              {t(PRIORITY_KEYS[preview.priority])}
            </span>
          ) : null}
          {picked.map((name) => (
            <span key={name} className={styles.tagChip}>
              #{name}
            </span>
          ))}
        </div>
      ) : null}

      {showPicker ? (
        <TagPicker
          tags={tags ?? []}
          selected={picked}
          onToggle={toggleTag}
          onCreate={handleCreateTag}
        />
      ) : null}

      <p className={styles.hint}>{t("quickAddHint")}</p>
    </form>
  );
}
