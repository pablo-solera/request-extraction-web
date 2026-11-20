export const THEME_COOKIE = "theme";
export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Oscuro",
};

/** Browser UI colors, kept in sync with the canvas token in globals.css. */
export const THEME_COLORS = { light: "#f4f4f5", dark: "#09090b" } as const;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Anything that is not a known theme falls back to following the system. */
export function parseTheme(value: unknown): Theme {
  return isTheme(value) ? value : "system";
}

/** Value for `<html data-theme>`; `undefined` leaves the system preference in charge. */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

export function applyThemeToDocument(theme: Theme, root: HTMLElement = document.documentElement) {
  const attribute = themeAttribute(theme);
  if (attribute) root.setAttribute("data-theme", attribute);
  else root.removeAttribute("data-theme");
}
