import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTheme: vi.fn() }));
vi.mock("@/lib/theme-server", () => ({ getTheme: mocks.getTheme }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var" });
  return { Geist: font, Geist_Mono: font, Newsreader: font };
});
vi.mock("@/app/globals.css", () => ({}));

import RootLayout, { generateViewport } from "@/app/layout";

describe("root layout theme", () => {
  beforeEach(() => vi.resetAllMocks());

  it("pins data-theme on <html> only when the user chose one", async () => {
    mocks.getTheme.mockResolvedValue("dark");
    expect((await RootLayout({ children: null })).props["data-theme"]).toBe("dark");
    mocks.getTheme.mockResolvedValue("system");
    expect((await RootLayout({ children: null })).props["data-theme"]).toBeUndefined();
  });

  it("follows the system for the browser chrome by default", async () => {
    mocks.getTheme.mockResolvedValue("system");
    const viewport = await generateViewport();
    expect(viewport.colorScheme).toBe("light dark");
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
      { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    ]);
  });

  it("uses a single scheme and color when a theme is pinned", async () => {
    mocks.getTheme.mockResolvedValue("light");
    expect(await generateViewport()).toEqual({ colorScheme: "light", themeColor: "#f4f4f5" });
    mocks.getTheme.mockResolvedValue("dark");
    expect(await generateViewport()).toEqual({ colorScheme: "dark", themeColor: "#09090b" });
  });
});
