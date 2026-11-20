import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));

import { THEME_COOKIE, applyThemeToDocument, isTheme, parseTheme, themeAttribute } from "@/lib/theme";
import { getTheme, setThemeCookie } from "@/lib/theme-server";

describe("theme values", () => {
  it("accepts only the three known themes and falls back to system", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("DARK")).toBe(false);
    expect(parseTheme("light")).toBe("light");
    for (const bad of [undefined, null, "", "blue", 1, {}]) expect(parseTheme(bad)).toBe("system");
  });

  it("leaves the attribute out for system so the OS preference decides", () => {
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });

  it("applies and clears data-theme on the document element", () => {
    const root = document.createElement("html");
    applyThemeToDocument("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyThemeToDocument("system", root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});

describe("theme cookie", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads the stored theme and ignores invalid values", async () => {
    mocks.get.mockReturnValueOnce({ value: "dark" });
    expect(await getTheme()).toBe("dark");
    mocks.get.mockReturnValueOnce({ value: "<script>" });
    expect(await getTheme()).toBe("system");
    mocks.get.mockReturnValueOnce(undefined);
    expect(await getTheme()).toBe("system");
    expect(mocks.get).toHaveBeenCalledWith(THEME_COOKIE);
  });

  it("stores the choice for a year, site-wide and not readable from scripts", async () => {
    await setThemeCookie("light");
    expect(mocks.set).toHaveBeenCalledWith(
      THEME_COOKIE,
      "light",
      expect.objectContaining({ httpOnly: true, maxAge: 31_536_000, path: "/", sameSite: "lax" }),
    );
  });
});

describe("theme stylesheet", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("follows the system by default and lets data-theme pin one scheme", () => {
    expect(css).toMatch(/:root\s*\{\s*color-scheme:\s*light dark;/);
    expect(css).toMatch(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/);
  });
});
