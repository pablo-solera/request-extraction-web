import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(auth)/login/actions", () => ({ loginAction: vi.fn() }));

import DashboardError from "@/app/(dashboard)/error";
import { LoginForm } from "@/components/auth/login-form";
import { ApprovalForm } from "@/components/extractions/approval-form";

afterEach(cleanup);

describe("approval form", () => {
  it("moves focus to the comment and requires it before confirming a rejection", async () => {
    const user = userEvent.setup();
    render(<ApprovalForm action={vi.fn()} axCode="AX-100" requestGroupId="550e8400-e29b-41d4-a716-446655440000" />);
    const comment = screen.getByLabelText("Comentario");

    expect(comment).not.toBeRequired();
    expect(comment).toHaveAccessibleDescription("Opcional al aprobar.");

    await user.click(screen.getByRole("button", { name: "Rechazar…" }));

    expect(comment).toHaveFocus();
    expect(comment).toBeRequired();
    expect(comment).toHaveAccessibleDescription("Obligatorio para rechazar: explica el motivo al solicitante.");
    expect(screen.getByRole("button", { name: "Aprobar" })).toHaveAttribute("formnovalidate");
  });
});

describe("login form", () => {
  it("labels both fields and toggles the password visibility with a pressed button", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const password = screen.getByLabelText("Contraseña");

    expect(screen.getByLabelText("Email corporativo")).toBeInTheDocument();
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("dashboard error page", () => {
  it("offers a way out to the start page and shows the error digest for support", () => {
    render(<DashboardError error={Object.assign(new Error("boom"), { digest: "abc123" })} unstable_retry={vi.fn()} />);

    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/extractions");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
