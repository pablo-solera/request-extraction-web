import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setThemeAction: vi.fn() }));
vi.mock("@/app/(dashboard)/actions", () => ({ setThemeAction: mocks.setThemeAction, logoutAction: vi.fn() }));

import { ThemeSelector } from "@/components/layout/theme-selector";

beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

describe("ThemeSelector", () => {
  it("is a labelled group of three radios with the current theme checked", () => {
    render(<ThemeSelector initialTheme="system" />);
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Sistema" })).toBeChecked();
  });

  it("applies the theme at once and saves it", async () => {
    mocks.setThemeAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ThemeSelector initialTheme="system" />);

    await user.click(screen.getByRole("radio", { name: "Oscuro" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(mocks.setThemeAction).toHaveBeenCalledWith("dark");

    await user.click(screen.getByRole("radio", { name: "Sistema" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(mocks.setThemeAction).toHaveBeenLastCalledWith("system");
  });

  it("goes back to the previous theme when saving fails", async () => {
    mocks.setThemeAction.mockResolvedValue({ ok: false });
    const user = userEvent.setup();
    render(<ThemeSelector initialTheme="light" />);

    await user.click(screen.getByRole("radio", { name: "Oscuro" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Claro" })).toBeChecked());
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
