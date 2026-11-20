import { clearCachedJson } from "@/lib/client/cached-json";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createExtractionAction } = vi.hoisted(() => ({ createExtractionAction: vi.fn() }));
vi.mock("@/app/(dashboard)/extractions/actions", () => ({ createExtractionAction }));

import { ExtractionForm } from "@/components/extractions/extraction-form";

const models = [
  { value: "248642", label: "248642 GLB 200", productGroup: "PC" },
  { value: "248644", label: "248644 GLB 220 d", productGroup: "PC" },
];

function readerFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/mercedes/series")) return Response.json({ options: [{ value: "GLB 248", label: "GLB 248" }, { value: "S-Class 223", label: "S-Class 223" }] });
    if (url.pathname.endsWith("/mercedes/models")) {
      const group = url.searchParams.get("productGroup");
      return Response.json({ options: group === "VAN" ? [] : models, productGroups: group ? [] : [{ value: "PC", label: "PC" }, { value: "VAN", label: "VAN" }] });
    }
    return Response.json({ error: { message: "Ruta no encontrada." } }, { status: 404 });
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function reachModels(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getAllByLabelText("Código AX")[0]!, "3f6");
  await user.type(screen.getAllByLabelText("Edición IMC")[0]!, "04/0");
  await user.type(screen.getAllByLabelText(/Fecha de finalización/)[0]!, "2026-10-20");
  await user.type(screen.getAllByLabelText(/Inicio del desarrollo/)[0]!, "2026-03-01");
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(screen.getByRole("button", { name: "Mercedes-Benz Group" }));
}

describe("extraction form for Mercedes-Benz", () => {
  it("preselects the only brand, cascades series to models and sends one vehicle per selected model", async () => {
    const fetchMock = readerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<ExtractionForm />);
    await reachModels(user);
    expect(screen.getByRole("button", { name: "Mercedes-Benz", pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    await user.selectOptions(await screen.findByRole("combobox", { name: "Serie" }), "GLB 248");
    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar modelo 248642 GLB 200" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar modelo 248644 GLB 220 d" }));
    await screen.findByRole("combobox", { name: "Grupo de producto" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Grupo de producto" }), "VAN");
    await screen.findByText("El reader no ha devuelto modelos para esta serie.");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("productGroup=VAN"))).toBe(true);
    await user.selectOptions(screen.getByRole("combobox", { name: "Grupo de producto" }), "");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("GLB 248 · 248642")).toBeInTheDocument();
    expect(screen.getByText("2 extracciones")).toBeInTheDocument();
    expect(JSON.parse((container.querySelector('input[name="vehicles"]') as HTMLInputElement).value)).toMatchObject([
      { manufacturerGroup: "Mercedes", brand: "Mercedes-Benz", series: "GLB 248", modelCode: "248642", modelDescription: "248642 GLB 200" },
      { manufacturerGroup: "Mercedes", brand: "Mercedes-Benz", series: "GLB 248", modelCode: "248644" },
    ]);
  });

  it("drops the selected models when the series changes and shows a retry when the reader fails", async () => {
    const fetchMock = readerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<ExtractionForm />);
    await reachModels(user);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Serie" }), "GLB 248");
    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar modelo 248642 GLB 200" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Serie" }), "S-Class 223");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Seleccionar modelo 248642 GLB 200" })).not.toBeChecked());
    expect(JSON.parse((container.querySelector('input[name="vehicles"]') as HTMLInputElement).value)).toEqual([]);

    cleanup();
    clearCachedJson();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "El servicio de Mercedes-Benz no está disponible." } }, { status: 502 })));
    render(<ExtractionForm />);
    await reachModels(user);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect((await screen.findAllByText("El servicio de Mercedes-Benz no está disponible.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("requires at least one model before leaving the models step", async () => {
    vi.stubGlobal("fetch", readerFetch());
    const user = userEvent.setup();
    render(<ExtractionForm />);
    await reachModels(user);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("combobox", { name: "Serie" });
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Añade al menos un vehículo.");
  });
});
