"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import type { TagRow } from "@/lib/database.types";
import styles from "./TagPicker.module.css";

/**
 * Tag chips plus an inline create field.
 *
 * Presentational on purpose: the parent owns the selected names and performs
 * the create request, so the quick-add bar and the edit sheet can share one
 * component while keeping their own state.
 */
export interface TagPickerProps {
  /** Every tag the user already has. */
  tags: TagRow[];
  /** Selected tag names, lower case. */
  selected: string[];
  onToggle: (name: string) => void;
  /** Create a tag, then refresh `tags`. The parent does the request. */
  onCreate: (name: string) => void | Promise<void>;
}

export function TagPicker({
  tags,
  selected,
  onToggle,
  onCreate,
}: TagPickerProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

  // A tag typed as #home in the quick-add bar has no row yet, but it is
  // selected — show it so the chip row matches what will be saved.
  const names = useMemo(() => {
    const list = tags.map((tag) => tag.name);
    for (const name of selected) if (!list.includes(name)) list.push(name);
    return list;
  }, [tags, selected]);

  const submit = async () => {
    const name = draft.trim().replace(/^#+/, "").trim().toLowerCase();
    if (!name) return; // never create an empty tag
    setCreating(true);
    try {
      await onCreate(name);
      setDraft("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.wrap}>
      {names.length === 0 ? (
        <span className={styles.empty}>{t("noTagsYet")}</span>
      ) : (
        <div className={styles.chips} role="group" aria-label={t("tagsLabel")}>
          {names.map((name) => {
            const active = selected.includes(name);
            return (
              <button
                key={name}
                type="button"
                className={`${styles.chip} ${active ? styles.chipActive : ""}`}
                aria-pressed={active}
                onClick={() => onToggle(name)}
              >
                #{name}
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.createRow}>
        <input
          className={styles.input}
          type="text"
          value={draft}
          placeholder={t("newTagPlaceholder")}
          aria-label={t("addTag")}
          maxLength={30}
          dir="auto"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // This input often sits inside the quick-add <form>; Enter here
            // must create the tag, not submit the task.
            e.preventDefault();
            e.stopPropagation();
            void submit();
          }}
        />
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => void submit()}
          disabled={creating || !draft.trim()}
        >
          {t("addTag")}
        </button>
      </div>
    </div>
  );
}
