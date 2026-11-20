import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createExtractionAction } = vi.hoisted(() => ({ createExtractionAction: vi.fn() }));
vi.mock("@/app/(dashboard)/extractions/actions", () => ({ createExtractionAction }));

import { ExtractionForm } from "@/components/extractions/extraction-form";

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function completeCommonStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getAllByLabelText("Código AX")[0]!, "1xf");
  await user.type(screen.getAllByLabelText("Edición IMC")[0]!, "05/0");
  await user.type(screen.getAllByLabelText(/Fecha de finalización/)[0]!, "2026-10-20");
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

  it("links each field error to its field and moves focus to the first invalid one", async () => {
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await user.type(screen.getAllByLabelText("Edición IMC")[0]!, "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const axCode = screen.getAllByLabelText("Código AX")[0]!;
    expect(axCode).toHaveAttribute("aria-invalid", "true");
    expect(axCode).toHaveFocus();
    expect(axCode).toHaveAccessibleDescription("El código AX debe tener entre 3 y 4 caracteres alfanuméricos.");
    expect(screen.getAllByLabelText("Edición IMC")[0]).toHaveAccessibleDescription("La edición debe tener el formato XX/X, por ejemplo 05/0.");
    expect(axCode).toHaveAttribute("pattern", "[A-Za-z0-9]{3,4}");
  });

  it("shows the AX code placeholder in normal case while the typed value is uppercase", () => {
    render(<ExtractionForm />);
    const input = screen.getAllByLabelText("Código AX")[0];
    expect(input).toHaveAttribute("placeholder", "Ej.: 1XF");
    expect(input).toHaveClass("uppercase", "placeholder:normal-case");
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

  it("explains what is lost in a dialog before switching group and keeps the group when declined", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/series")) return Response.json({ options: [{ value: "7", label: "7 Series" }] });
      return Response.json({ options: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await completeCommonStep(user);
    await user.click(screen.getByRole("button", { name: "BMW Group" }));
    await user.click(screen.getByRole("button", { name: /^BMW$/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Serie" }), "7");
    await user.click(screen.getByRole("button", { name: "Atrás" }));

    await user.click(screen.getByRole("button", { name: "Renault Group" }));
    const dialog = screen.getByRole("dialog", { name: "¿Cambiar de grupo?" });
    expect(dialog).toHaveTextContent("Se borrará el modelo seleccionado");
    await user.click(within(dialog).getByRole("button", { name: "Mantener grupo" }));
    expect(screen.getByRole("button", { name: "BMW Group" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Renault Group" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cambiar de grupo" }));
    expect(screen.getByRole("button", { name: "Renault Group" })).toHaveAttribute("aria-pressed", "true");
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

  async function chooseTypekey(user: ReturnType<typeof userEvent.setup>, fetchMock: ReturnType<typeof vi.fn>, typekey: string) {
    await completeCommonStep(user);
    await user.click(screen.getByRole("button", { name: "BMW Group" }));
    await user.click(screen.getByRole("button", { name: /^BMW$/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Serie" }), "6'");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Código de desarrollo" }), "F13");
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("developmentCode=F13"))).toBe(true));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Typekey" }), typekey);
  }

  async function reachSummary(user: ReturnType<typeof userEvent.setup>, fetchMock: ReturnType<typeof vi.fn>, typekey: string) {
    await chooseTypekey(user, fetchMock, typekey);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
  }

  function conflictFetch(conflict: boolean) {
    const base = availabilityFetch({ "6J92": { typekey: "6J92", status: "available", suggestedTypekey: null } }, ["6J92"]);
    return vi.fn(async (input: RequestInfo | URL) => String(input).includes("/table-conflict")
      ? Response.json({ conflict, loadedAt: conflict ? "2026-10-26T14:21:00.000Z" : null })
      : base(input));
  }

  it("asks for confirmation before submitting when the table is already loaded in BMW_Labour", async () => {
    const fetchMock = conflictFetch(true);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "6J92");

    const checkbox = await screen.findByRole("checkbox", { name: /Entiendo que se perderán los datos anteriores/ });
    expect(screen.getByText(/Ya hay datos cargados en BMW_Labour/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar extracción" })).toBeDisabled();
    expect(container.querySelector('input[name="confirmReplace"]')).toHaveValue("false");

    await user.click(checkbox);
    expect(screen.getByRole("button", { name: "Iniciar extracción" })).toBeEnabled();
    expect(container.querySelector('input[name="confirmReplace"]')).toHaveValue("true");
    const call = fetchMock.mock.calls.map(([input]) => String(input)).find((input) => input.includes("/table-conflict"))!;
    expect(call).toContain("axCode=1XF");
    expect(call).toContain("imcEdition=05%2F0");
    expect(call).toContain("brand=BMW");
  });

  it("shows no confirmation when no table is loaded for that AX code and edition", async () => {
    const fetchMock = conflictFetch(false);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "6J92");

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/table-conflict"))).toBe(true));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar extracción" })).toBeEnabled();
  });

  it("stops at the models step and lists what changes when the base type differs, offering swap or removal", async () => {
    const fetchMock = availabilityFetch({
      "6J02": { typekey: "6J02", status: "unavailable", code: "CGWATB0085", suggestedTypekey: null, baseType: { typekey: "6J92", status: "available", reliable: false, differences: [{ attribute: "transmission", requested: "AUT", baseType: "MECH" }] } },
      "6J92": { typekey: "6J92", status: "available", suggestedTypekey: null },
    }, ["6J02", "6J92"]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "6J02");

    expect(await screen.findByText("Un typekey no tiene datos en BMW")).toBeInTheDocument();
    expect(screen.getByText("cambio (automático → manual)")).toBeInTheDocument();
    expect(screen.getByText("Paso 3 de 4 · Modelos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar 6J02 de la solicitud" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sustituir 6J02 por el tipo base 6J92" }));
    expect(screen.queryByText("Un typekey no tiene datos en BMW")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Typekey" })).toHaveValue("6J92");

    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Paso 4 de 4 · Resumen")).toBeInTheDocument();
    expect(screen.getByText("6' · F13 · 6J92")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar extracción" })).toBeEnabled();
  });

  it("says the base type is identical and removes a typekey without data when asked", async () => {
    const fetchMock = availabilityFetch({
      "6J03": { typekey: "6J03", status: "unavailable", code: "CGWATB0085", suggestedTypekey: "6J93", baseType: { typekey: "6J93", status: "available", reliable: true, differences: [] } },
      "6J93": { typekey: "6J93", status: "available", suggestedTypekey: null },
    }, ["6J03", "6J93"]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "6J03");

    expect(await screen.findByText(/es igual en todas las características/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar 6J03 de la solicitud" }));

    expect(screen.queryByText("Un typekey no tiene datos en BMW")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Typekey" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("Paso 3 de 4 · Modelos")).toBeInTheDocument();
  });

  it("only offers removal when the typekey has no base type with data", async () => {
    const fetchMock = availabilityFetch({
      YM13: { typekey: "YM13", status: "unavailable", code: "CGWATB0085", suggestedTypekey: null },
    }, ["YM13"]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachSummary(user, fetchMock, "YM13");

    expect(await screen.findByText(/no tiene un tipo base con datos que pueda sustituirlo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sustituir/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar YM13 de la solicitud" })).toBeInTheDocument();
  });

  it("disables the continue button while checking and does not repeat answered checks", async () => {
    const answers = { "6J92": { typekey: "6J92", status: "available", suggestedTypekey: null } };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const base = availabilityFetch(answers, ["6J92"]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/availability")) await gate;
      return base(input);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await chooseTypekey(user, fetchMock, "6J92");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("button", { name: "Comprobando disponibilidad (0/1)…" })).toBeDisabled();
    release();
    expect(await screen.findByText("Paso 4 de 4 · Resumen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Atrás" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Paso 4 de 4 · Resumen")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/availability"))).toHaveLength(1);
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
