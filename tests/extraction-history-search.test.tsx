import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionListItem } from "@/lib/extractions/types";

const { loadHistory } = vi.hoisted(() => ({ loadHistory: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/app/(dashboard)/history/actions", () => ({ extractionAction: vi.fn(), extractionDetail: vi.fn(), loadHistory }));

import { ExtractionHistory } from "@/components/extractions/extraction-history";

beforeEach(() => {
  loadHistory.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function item(overrides: Partial<ExtractionListItem> = {}): ExtractionListItem {
  return {
    id: crypto.randomUUID(),
    requestGroupId: crypto.randomUUID(),
    axCode: "AX-100",
    imcEdition: "05/0",
    completion: "2026-10-30",
    developmentStart: "2026-01-15",
    manufacturerGroup: "BMW",
    brand: "BMW",
    modelDescription: "X5 · G05",
    modelCode: "41HZ",
    domain: "labours",
    status: "completed",
    requestStatus: "approved",
    errorMessage: null,
    progress: 100,
    readerStatus: "completed",
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    downloadReady: false,
    requesterName: null,
    readerStalled: false,
    canCancel: false,
    canResume: false,
    canForceResume: false,
    canViewDetails: false,
    ...overrides,
  };
}

describe("compact history rows", () => {
  it("shows one compact row per request and reveals the shared data only when expanded", async () => {
    const user = userEvent.setup();
    render(<ExtractionHistory initialItems={[item({ axCode: "AX-1" }), item({ axCode: "AX-2", status: "failed", progress: 10 })]} />);

    const header = screen.getByRole("button", { name: /^AX-1/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("1 typekey");
    expect(screen.queryByText("Edición IMC")).not.toBeInTheDocument();

    await user.click(header);
    expect(screen.getByText("Edición IMC")).toBeVisible();
  });

  it("filters the loaded requests by aggregate status and lets the filter be cleared", async () => {
    const user = userEvent.setup();
    render(<ExtractionHistory initialItems={[item({ axCode: "AX-OK" }), item({ axCode: "AX-KO", status: "failed", progress: 10 })]} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Estado" }), "failed");
    expect(screen.queryByRole("button", { name: /^AX-OK/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^AX-KO/ })).toBeInTheDocument();
    expect(screen.getByText("1 de 2 solicitudes cargadas")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByRole("button", { name: /^AX-OK/ })).toBeInTheDocument();
  });

  it("searches by AX code on the server after typing and replaces the list", async () => {
    const user = userEvent.setup();
    loadHistory.mockResolvedValue({ ok: true, items: [item({ axCode: "1XF" })], transformer: {}, nextCursor: null });
    render(<ExtractionHistory initialItems={[item({ axCode: "AX-OLD" })]} />);

    await user.type(screen.getByRole("searchbox", { name: "Buscar por código AX" }), "1xf");

    await waitFor(() => expect(loadHistory).toHaveBeenCalledWith({ query: "1xf" }));
    expect(await screen.findByRole("button", { name: /^1XF/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^AX-OLD/ })).not.toBeInTheDocument();
  });

  it("loads the next page with the cursor and skips requests that are already listed", async () => {
    const user = userEvent.setup();
    const first = item({ axCode: "AX-1" });
    const cursor = { createdAt: "2026-10-20 12:00:00+00", requestGroupId: crypto.randomUUID() };
    loadHistory.mockResolvedValue({ ok: true, items: [first, item({ axCode: "AX-2" })], transformer: {}, nextCursor: null });
    render(<ExtractionHistory initialItems={[first]} initialNextCursor={cursor} />);

    await user.click(screen.getByRole("button", { name: "Cargar más solicitudes" }));

    expect(loadHistory).toHaveBeenCalledWith({ cursor, query: "" });
    expect(await screen.findByRole("button", { name: /^AX-2/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^AX-1/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cargar más solicitudes" })).not.toBeInTheDocument();
  });

  it("explains a failed page load without losing the loaded requests", async () => {
    const user = userEvent.setup();
    loadHistory.mockResolvedValue({ ok: false, message: "No se ha podido cargar el historial. Inténtalo de nuevo." });
    render(<ExtractionHistory initialItems={[item({ axCode: "AX-1" })]} initialNextCursor={{ createdAt: "2026-10-20 12:00:00+00", requestGroupId: crypto.randomUUID() }} />);

    await user.click(screen.getByRole("button", { name: "Cargar más solicitudes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se ha podido cargar el historial");
    expect(screen.getByRole("button", { name: /^AX-1/ })).toBeInTheDocument();
  });

  it("retries the failed page load from the error alert", async () => {
    const user = userEvent.setup();
    const cursor = { createdAt: "2026-10-20 12:00:00+00", requestGroupId: crypto.randomUUID() };
    loadHistory
      .mockResolvedValueOnce({ ok: false, message: "No se ha podido cargar el historial. Inténtalo de nuevo." })
      .mockResolvedValueOnce({ ok: true, items: [item({ axCode: "AX-2" })], transformer: {}, nextCursor: null });
    render(<ExtractionHistory initialItems={[item({ axCode: "AX-1" })]} initialNextCursor={cursor} />);

    await user.click(screen.getByRole("button", { name: "Cargar más solicitudes" }));
    await user.click(await screen.findByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("button", { name: /^AX-2/ })).toBeInTheDocument();
    expect(loadHistory).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells the user when a filter hides requests but more are still unloaded", async () => {
    const user = userEvent.setup();
    render(<ExtractionHistory initialItems={[item({ axCode: "AX-OK" })]} initialNextCursor={{ createdAt: "2026-10-20 12:00:00+00", requestGroupId: crypto.randomUUID() }} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Estado" }), "failed");

    expect(screen.getByText(/Hay más solicitudes sin cargar/)).toBeInTheDocument();
  });
});
