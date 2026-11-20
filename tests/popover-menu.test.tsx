import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(dashboard)/actions", () => ({ logoutAction: vi.fn() }));

import { UserMenu } from "@/components/layout/user-menu";

afterEach(cleanup);

describe("user menu popover", () => {
  it("opens from the account button, exposes the logout action and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<UserMenu user={{ email: "ana@example.com", name: "Ana Pérez", role: "coordinator" }} />);
    const trigger = screen.getByRole("button", { name: "Cuenta de Ana Pérez" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();
  });
});
