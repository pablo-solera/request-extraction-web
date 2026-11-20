import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
const theme = css.slice(css.indexOf("@theme {"), css.indexOf("}", css.indexOf("@theme {")));

type Pair = { light: string; dark: string };
const tokens = new Map<string, Pair>();
for (const match of theme.matchAll(/--color-([a-z-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\);/g)) {
  tokens.set(match[1], { light: match[2], dark: match[3] });
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function value(token: string, scheme: keyof Pair) {
  const pair = tokens.get(token);
  if (!pair) throw new Error(`Missing token ${token}`);
  return pair[scheme];
}

describe("color tokens", () => {
  it("declares every color token (except scrim) as a light-dark pair", () => {
    const declared = [...theme.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]).filter((name) => name !== "scrim");
    expect(declared.length).toBeGreaterThan(30);
    for (const name of declared) expect(tokens.has(name), name).toBe(true);
  });

  it("gives each token different light and dark values for surfaces and ink", () => {
    for (const name of ["canvas", "surface", "ink", "ink-strong", "ink-muted"]) {
      expect(value(name, "light")).not.toBe(value(name, "dark"));
    }
  });

  it("opts in to both color schemes", () => {
    expect(css).toMatch(/color-scheme:\s*light dark/);
  });

  const schemes: Array<keyof Pair> = ["light", "dark"];
  const textPairs: Array<[string, string]> = [];
  for (const ink of ["ink", "ink-strong", "ink-secondary", "ink-muted"]) {
    for (const bg of ["canvas", "surface", "surface-sunken"]) textPairs.push([ink, bg]);
  }
  textPairs.push(["accent-ink", "accent-wash"], ["accent-ink", "surface"], ["surface", "ink-strong"], ["surface", "hover-fill"], ["surface", "ink-muted"]);
  for (const tone of ["pending", "running", "success", "danger", "issue", "info", "neutral"]) {
    textPairs.push([`${tone}-ink`, `${tone}-wash`], [`${tone}-ink`, "surface"], [`${tone}-ink`, "canvas"]);
  }

  for (const scheme of schemes) {
    it.each(textPairs)(`${scheme}: %s on %s meets AA text contrast (4.5:1)`, (fg, bg) => {
      expect(contrast(value(fg, scheme), value(bg, scheme))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(["canvas", "surface"])(`${scheme}: focus ring is visible (3:1) on %s`, (bg) => {
      expect(contrast(value("focus", scheme), value(bg, scheme))).toBeGreaterThanOrEqual(3);
    });

    it(`${scheme}: progress fill is visible (3:1) on its track`, () => {
      expect(contrast(value("focus", scheme), value("line-soft", scheme))).toBeGreaterThanOrEqual(3);
    });

    it(`${scheme}: state borders stay distinguishable from their wash`, () => {
      for (const tone of ["pending", "running", "success", "danger", "issue", "info", "neutral"]) {
        expect(value(`${tone}-line`, scheme), tone).not.toBe(value(`${tone}-wash`, scheme));
      }
    });
  }
});
