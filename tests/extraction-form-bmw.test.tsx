import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createExtractionAction } = vi.hoisted(() => ({ createExtractionAction: vi.fn() }));
vi.mock("@/app/(dashboard)/extractions/actions", () => ({ createExtractionAction }));

import { ExtractionForm } from "@/components/extractions/extraction-form";

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function completeCommonStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getAllByLabelText("Código AX")[0]!, "AX_123");
  await user.type(screen.getAllByLabelText("Edición IMC")[0]!, "05/0");
  await user.type(screen.getAllByLabelText(/Completion/)[0]!, "2026-10-20");
  await user.type(screen.getAllByLabelText(/Inicio del desarrollo/)[0]!, "2026-03-01");
  await user.click(screen.getByRole("button", { name: "Continuar" }));
}

async function chooseBmw(user: ReturnType<typeof userEvent.setup>, fetchMock: ReturnType<typeof vi.fn>) {
  await user.click(screen.getByRole("button", { name: "BMW Group" }));
  await user.click(screen.getByRole("button", { name: /^BMW$/ }));
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.selectOptions(await screen.findByRole("combobox", { name: "Serie" }), "7");
  await user.selectOptions(await screen.findByRole("combobox", { name: "Código de desarrollo" }), "G70");
  await screen.findByRole("combobox", { name: "Typekey" });
  await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("developmentCode=G70"))).toBe(true));
}

describe("extraction request stepper", () => {
  it("keeps common data while navigating and shows the selected group manufacturers", async () => {
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await completeCommonStep(user);

    expect(screen.getByText("Paso 2 de 4 · Fabricante")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /VAG/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Renault Group" }));
    await user.click(screen.getByRole("button", { name: "Dacia" }));
    await user.click(screen.getByRole("button", { name: "Atrás" }));

    expect(screen.getAllByLabelText("Código AX")[0]).toHaveValue("AX_123");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("button", { name: "Dacia" })).toHaveAttribute("aria-pressed", "true");
  });

  it("loads BMW options in step three after the common and manufacturer steps", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/series")) return Response.json({ options: [{ value: "7", label: "7 Series" }] });
      if (url.pathname.endsWith("/development-codes")) return Response.json({ options: [{ value: "G70", label: "G70" }] });
      if (url.pathname.endsWith("/typekeys")) return Response.json({ options: [{ value: "41HZ", label: "41HZ · 2,998 l · 210 kW · desde 01/07/2026" }] });
      return Response.json({ error: { message: "Ruta no encontrada." } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await completeCommonStep(user);
    await chooseBmw(user, fetchMock);

    await user.selectOptions(screen.getByRole("combobox", { name: "Typekey" }), "41HZ");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("7 · G70 · 41HZ")).toBeInTheDocument();
    expect(screen.getAllByText("1 extracción")).toHaveLength(2);
    expect(screen.getByText("01/03/2026")).toBeInTheDocument();
  });

  it("reports malformed BMW options with a retry control", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ series: "7'" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await completeCommonStep(user);
    await user.click(screen.getByRole("button", { name: "BMW Group" }));
    await user.click(screen.getByRole("button", { name: /^BMW$/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("BMW ha devuelto una lista de opciones no válida.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("turns pasted typekeys into one summary extraction per selected code", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/series")) return Response.json({ options: [{ value: "7", label: "7 Series" }] });
      if (url.pathname.endsWith("/development-codes")) return Response.json({ options: [{ value: "G70", label: "G70" }] });
      if (url.pathname.endsWith("/typekeys")) return Response.json({ options: [{ value: "11EH", label: "11EH" }, { value: "41HZ", label: "41HZ" }] });
      return Response.json({ options: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await completeCommonStep(user);
    await chooseBmw(user, fetchMock);
    await user.type(await screen.findByLabelText("Pegar varios typekeys"), "11eh, 41HZ");
    await user.click(screen.getByRole("button", { name: "Añadir typekeys" }));

    expect(await screen.findByText("2 typekeys añadidos.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getAllByText(/11EH|41HZ/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("2 extracciones")).toHaveLength(2);
  });

  it("loads and summarizes several Renault families for the selected single manufacturer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ options: [{ value: "B52", label: "Sandero" }, { value: "HJD", label: "Duster" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await completeCommonStep(user);
    await user.click(screen.getByRole("button", { name: "Renault Group" }));
    await user.click(screen.getByRole("button", { name: "Dacia" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar familia Sandero" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar familia Duster" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("Dacia")).toBeInTheDocument();
    expect(screen.getAllByText("2 extracciones")).toHaveLength(2);
    expect(screen.getByText("B52")).toBeInTheDocument();
    expect(screen.getByText("HJD")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/readers/renault/families?brand=Dacia"), expect.objectContaining({ cache: "no-store" }));
  });
});
