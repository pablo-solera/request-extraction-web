import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransformerPanel } from "@/components/extractions/transformer-panel";
import type { TransformerRequestInfo } from "@/lib/transformer/info";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const group = "7be5f2af-879b-4c61-84d5-6e728f438a02";
const info = (overrides: Partial<TransformerRequestInfo> = {}): TransformerRequestInfo => ({
  requestGroupId: group, applicable: true, loadStatus: null, loadError: null, loadedAt: null, canRetryLoad: false, canUpload: false, comparisons: [], ...overrides,
});
const answer = (value: TransformerRequestInfo) => Response.json({ [group]: value });

describe("transformer panel", () => {
  it("renders nothing for requests that do not use the transformer", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render(<TransformerPanel allCompleted initialInfo={info({ applicable: false })} requestGroupId={group} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains that the load waits for every typekey and does not poll yet", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<TransformerPanel allCompleted={false} initialInfo={info()} requestGroupId={group} />);
    expect(screen.getByText(/cuando todos los typekeys estén completados/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows a running load until the data is loaded and then offers the LST upload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer(info({ loadStatus: "completed", loadedAt: "2026-10-23T10:00:00.000Z", canUpload: true })));
    vi.stubGlobal("fetch", fetchMock);
    render(<TransformerPanel allCompleted initialInfo={info({ loadStatus: "running" })} requestGroupId={group} />);

    expect(screen.getByText("Cargando los datos en BMW_Labour…")).toBeInTheDocument();
    expect(await screen.findByText(/Datos cargados en BMW_Labour/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/requests/transformer?id=${group}`);
    expect(screen.getByRole("button", { name: "Comparar con .LST" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Listado maestro/)).toHaveAttribute("accept", ".lst,.zip");
  });

  it("shows the failure and retries the load", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 202 }))
      .mockResolvedValue(answer(info({ loadStatus: null })));
    vi.stubGlobal("fetch", fetchMock);
    render(<TransformerPanel allCompleted initialInfo={info({ loadStatus: "failed", loadError: "SQL no disponible", canRetryLoad: true })} requestGroupId={group} />);

    expect(screen.getByRole("alert")).toHaveTextContent("La carga en BMW_Labour ha fallado: SQL no disponible");
    await user.click(screen.getByRole("button", { name: "Reintentar carga" }));

    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/requests/${group}/load/retry`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    expect(await screen.findByText("Preparando la carga en BMW_Labour…")).toBeInTheDocument();
  });

  it("uploads the selected file, reports the result and lists comparisons with their Excel", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "cmp-1" }, { status: 202 }))
      .mockResolvedValue(answer(info({ loadStatus: "completed", canUpload: true, comparisons: [{ id: "cmp-1", filename: "listing.lst", status: "completed", error: null, createdAt: "2026-10-23T11:00:00.000Z", downloadReady: true }] })));
    vi.stubGlobal("fetch", fetchMock);
    render(<TransformerPanel allCompleted initialInfo={info({ loadStatus: "completed", canUpload: true })} requestGroupId={group} />);

    await user.upload(screen.getByLabelText(/Listado maestro/), new File(["lst"], "listing.lst"));
    await user.click(screen.getByRole("button", { name: "Comparar con .LST" }));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/requests/${group}/comparisons`);
    expect(((init as RequestInit).body as FormData).get("file")).toBeInstanceOf(File);
    expect(await screen.findByText(/Comparación iniciada/)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Descargar Excel" })).toHaveAttribute("href", "/api/comparisons/cmp-1/download");
  });

  it("asks for a file before uploading and shows the server's rejection", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { message: "El fichero debe ser un .LST o un .ZIP con un único .LST." } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TransformerPanel allCompleted initialInfo={info({ loadStatus: "completed", canUpload: true })} requestGroupId={group} />);

    fireEvent.submit(screen.getByRole("button", { name: "Comparar con .LST" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Selecciona un fichero .LST o .ZIP.");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.upload(screen.getByLabelText(/Listado maestro/), new File(["x"], "notes.lst"));
    await user.click(screen.getByRole("button", { name: "Comparar con .LST" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("El fichero debe ser un .LST o un .ZIP"));
  });
});
