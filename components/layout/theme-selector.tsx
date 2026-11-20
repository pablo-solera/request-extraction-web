"use client";

import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/(dashboard)/actions";
import { THEMES, THEME_LABELS, applyThemeToDocument, type Theme } from "@/lib/theme";

export function ThemeSelector({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [, startTransition] = useTransition();

  function choose(next: Theme) {
    const previous = theme;
    setTheme(next);
    applyThemeToDocument(next);
    startTransition(async () => {
      const result = await setThemeAction(next);
      if (!result.ok) {
        setTheme(previous);
        applyThemeToDocument(previous);
      }
    });
  }

  return (
    <fieldset className="border-b border-line-soft px-3 pb-2 pt-1">
      <legend className="px-0 py-1 text-meta font-medium text-ink-muted">Tema</legend>
      {THEMES.map((value) => (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 text-body text-ink-secondary hover:text-ink-strong" key={value}>
          <input
            checked={theme === value}
            className="size-4 accent-focus"
            name="theme"
            onChange={() => choose(value)}
            type="radio"
            value={value}
          />
          {THEME_LABELS[value]}
        </label>
      ))}
    </fieldset>
  );
}
