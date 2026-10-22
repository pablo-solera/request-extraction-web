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
  await user.type(screen.getAllByLabelText("Código AX")[0]!, "1xf");
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
  it("ignores spaces and symbols typed in the AX code", async () => {
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await user.type(screen.getAllByLabelText("Código AX")[0]!, " a b-1_x ");
    expect(screen.getAllByLabelText("Código AX")[0]).toHaveValue("AB1X");
  });

  it("keeps common data while navigating and shows the selected group manufacturers", async () => {
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await completeCommonStep(user);

    expect(screen.getByText("Paso 2 de 4 · Fabricante")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /VAG/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Renault Group" }));
    await user.click(screen.getByRole("button", { name: "Dacia" }));
    await user.click(screen.getByRole("button", { name: "Atrás" }));

    expect(screen.getAllByLabelText("Código AX")[0]).toHaveValue("1XF");
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
    expect(screen.getAllByText("1 extracción")).toHaveLength(1);
    expect(screen.getByText("01/03/2026")).toBeInTheDocument();
  });

  function availabilityFetch(answers: Record<string, unknown>, typekeys: string[]) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/series")) return Response.json({ options: [{ value: "6'", label: "6'" }] });
      if (url.pathname.endsWith("/development-codes")) return Response.json({ options: [{ value: "F13", label: "F13" }] });
      if (url.pathname.endsWith("/typekeys")) return Response.json({ options: typekeys.map((value) => ({ value, label: value })) });
      if (url.pathname.endsWith("/availability")) return Response.json({ availability: answers[url.searchParams.get("typekey")!] });
      return Response.json({ error: { message: "Ruta no encontrada." } }, { status: 404 });
    });
  }

  async function reachSummary(user: ReturnType<typeof userEvent.setup>, fetchMock: ReturnType<typeof vi.fn>, typekey: string) {
    await completeCommonStep(user);
    await user.click(screen.getByRole("button", { name: "BMW Group" }));
    await user.click(screen.getByRole("button", { name: /^BMW$/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Serie" }), "6'");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Código de desarrollo" }), "F13");
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("developmentCode=F13"))).toBe(true));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Typekey" }), typekey);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
  }

  it("blocks submission for an unavailable typekey and explains why its base type is not suggested", async () => {
    const fetchMock = availabilityFetch({
      "6J02": { typekey: "6J02", status: "unavailable", code: "CGWATB0085", suggestedTypekey: null, baseType: { typekey: "6J92", status: "available", reliable: false, differences: [{ attribute: "transmission", requested: "AUT", baseType: "MECH" }] } },
    }, ["6J02"]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "6J02");

    expect(await screen.findByText("6J02: No disponible en BMW Flat Rates (CGWATB0085).")).toBeInTheDocument();
    expect(screen.getByText("Tipo base 6J92 disponible, pero difiere en: cambio (automático → manual). No se sugiere.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usar tipo base/ })).not.toBeInTheDocument();
    expect(screen.getByText(/BMW no tiene tiempos para 6J02/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar extracción" })).toBeDisabled();
  });

  it("replaces an unavailable typekey with its reliable base type and re-enables submission", async () => {
    const fetchMock = availabilityFetch({
      "6J03": { typekey: "6J03", status: "unavailable", code: "CGWATB0085", suggestedTypekey: "6J93", baseType: { typekey: "6J93", status: "available", reliable: true, differences: [] } },
      "6J93": { typekey: "6J93", status: "available", suggestedTypekey: null },
    }, ["6J03", "6J93"]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "6J03");

    await user.click(await screen.findByRole("button", { name: "Usar tipo base 6J93" }));

    expect(await screen.findByText("6' · F13 · 6J93")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar extracción" })).toBeEnabled());
    expect(screen.queryByText(/No disponible en BMW Flat Rates/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/availability") && String(input).includes("typekey=6J93"))).toBe(true);
  });

  it("lets an available typekey through and keeps submission possible when BMW cannot be checked", async () => {
    const fetchMock = availabilityFetch({ "6J92": { typekey: "6J92", status: "unknown", suggestedTypekey: null } }, ["6J92"]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "6J92");

    expect(await screen.findByText("BMW no ha respondido a tiempo; se volverá a comprobar al enviar la solicitud.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar extracción" })).toBeEnabled();
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
    expect(screen.getAllByText("2 extracciones")).toHaveLength(1);
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
    expect(screen.getAllByText("2 extracciones")).toHaveLength(1);
    expect(screen.getByText("B52")).toBeInTheDocument();
    expect(screen.getByText("HJD")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/readers/renault/families?brand=Dacia"), expect.objectContaining({ cache: "no-store" }));
  });
});
