import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionListItem } from "@/lib/extractions/types";

const replace = vi.fn();
const { extractionAction, extractionDetail } = vi.hoisted(() => ({ extractionAction: vi.fn(), extractionDetail: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/app/(dashboard)/history/actions", () => ({ extractionAction, extractionDetail }));

import { ExtractionHistory } from "@/components/extractions/extraction-history";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function openAll() {
  for (const button of screen.getAllByRole("button", { expanded: false })) fireEvent.click(button);
}

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
    status: "running",
    requestStatus: "approved",
    errorMessage: null,
    progress: 45,
    readerStatus: "rate_limited",
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

describe("BMW extraction progress in history", () => {
  it("shows the reader percentage and pause notice with an accessible progress bar", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<ExtractionHistory initialItems={[item()]} />);
    openAll();

    expect(screen.getByText("En pausa por límite de BMW")).toBeInTheDocument();
    expect(screen.getAllByText("45%")).toHaveLength(2);
    expect(screen.getByRole("progressbar", { name: "Progreso de la solicitud AX-100" })).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByRole("progressbar", { name: "Progreso de AX-100" })).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByRole("progressbar", { name: "Progreso de AX-100" }).firstElementChild).toHaveStyle({ transform: "scaleX(0.45)" });
  });

  it("shows queue and paused notices without displaying a completed progress bar", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<ExtractionHistory initialItems={[
      item({ id: "queued", axCode: "AX-Q", readerStatus: "queued", progress: 0 }),
      item({ id: "paused", axCode: "AX-P", readerStatus: "paused", progress: 30 }),
      item({ id: "completed", axCode: "AX-C", status: "completed", progress: 100, readerStatus: "completed" }),
    ]} />);
    openAll();

    expect(screen.getByText("En cola")).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progreso de AX-Q" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("progressbar", { name: "Progreso de AX-P" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.queryByRole("progressbar", { name: "Progreso de AX-C" })).not.toBeInTheDocument();
  });

  it("offers per-extraction actions in the accessible options menu and reports the result", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    extractionAction.mockResolvedValueOnce({ ok: true, status: "cancelled", readerStatus: "cancelled" });
    render(<ExtractionHistory initialItems={[item({ canCancel: true, canResume: true, progress: null })]} />);
    openAll();

    await user.click(screen.getAllByRole("button", { name: "Opciones para AX-100, X5 · G05, 41HZ" })[0]!);
    expect(screen.getByRole("button", { name: "Reanudar extracción de 41HZ" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Opciones para AX-100, X5 · G05, 41HZ" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Cancelar extracción" }));
    const dialog = screen.getByRole("dialog", { name: "¿Cancelar la extracción?" });
    expect(dialog).toHaveTextContent("tendrás que volver a solicitarla");
    expect(extractionAction).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar extracción" }));

    expect(extractionAction).toHaveBeenCalledWith({ id: expect.any(String), action: "cancel", force: false });
    expect(await screen.findByText("Extracción cancelada.")).toBeInTheDocument();
    expect(screen.getAllByText("Cancelada", { selector: "span" })).toHaveLength(2);
  });

  it("does not cancel when the user keeps the extraction in the dialog", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    extractionAction.mockClear();
    render(<ExtractionHistory initialItems={[item({ canCancel: true, progress: null })]} />);
    openAll();

    await user.click(screen.getAllByRole("button", { name: "Opciones para AX-100, X5 · G05, 41HZ" })[0]!);
    await user.click(screen.getByRole("button", { name: "Cancelar extracción" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mantener" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(extractionAction).not.toHaveBeenCalled();
  });

  it("loads authorized per-typekey reader details", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    extractionDetail.mockResolvedValueOnce({ ok: true, detail: { status: "completed", stage: "completed", progress: 100, stalled: false, typekeys: [{ typekey: "41HZ", series: "X", family: "G05", completed: 2785, total: 2785, remaining: 0, failed: 0, groups: 34 }] } });
    render(<ExtractionHistory initialItems={[item({ status: "failed", progress: null, canViewDetails: true })]} />);
    openAll();

    await user.click(screen.getAllByRole("button", { name: "Opciones para AX-100, X5 · G05, 41HZ" })[0]!);
    expect(within(screen.getByLabelText("Acciones para AX-100")).queryByRole("link", { name: "Volver a solicitar" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver detalles" }));

    expect(extractionDetail).toHaveBeenCalledWith(expect.any(String));
    expect(await screen.findByRole("region", { name: "Detalle de la extracción AX-100" })).toBeInTheDocument();
    expect(screen.getByText("2785 / 2785")).toBeInTheDocument();
  });
});

describe("grouped request history", () => {
  const group = crypto.randomUUID();
  const rows = () => [
    item({ id: "a", requestGroupId: group, modelCode: "11EH", status: "completed", progress: 100, readerStatus: "completed" }),
    item({ id: "b", requestGroupId: group, modelCode: "12EH", status: "failed", progress: 20, canResume: true }),
    item({ id: "c", requestGroupId: group, modelCode: "13EH", status: "completed", progress: 100, readerStatus: "completed" }),
  ];

  beforeEach(() => { extractionAction.mockReset(); });

  it("shows one card per request with the shared data and an aggregate summary", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<ExtractionHistory initialItems={rows()} />);
    openAll();

    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByText("Completada con incidencias", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("2 de 3 typekeys completados · 1 fallido")).toBeInTheDocument();
    expect(screen.getByText("Edición IMC").parentElement).toHaveTextContent("05/0");
    expect(screen.getByText("Inicio del desarrollo")).toBeInTheDocument();
    expect(screen.getByText("Fecha de finalización")).toBeInTheDocument();
  });

  it("offers to repeat the whole request once nothing is running, even when everything completed", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    const { unmount } = render(<ExtractionHistory initialItems={rows()} />);
    openAll();
    expect(screen.getAllByRole("link", { name: "Volver a solicitar" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Volver a solicitar" })).toHaveAttribute("href", `/extractions?request=${group}`);
    unmount();

    render(<ExtractionHistory initialItems={rows().map((entry) => ({ ...entry, status: "completed" as const, canResume: false }))} />);
    openAll();
    expect(screen.getByRole("link", { name: "Volver a solicitar" })).toBeInTheDocument();
  });

  it("does not offer repeating while a typekey is still running or the request awaits approval", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    const { unmount } = render(<ExtractionHistory initialItems={[...rows(), item({ id: "r", requestGroupId: group, status: "running", progress: 10 })]} />);
    openAll();
    expect(screen.queryByRole("link", { name: "Volver a solicitar" })).not.toBeInTheDocument();
    unmount();

    render(<ExtractionHistory initialItems={rows().map((entry) => ({ ...entry, requestStatus: "pending" as const }))} />);
    openAll();
    expect(screen.queryByRole("link", { name: "Volver a solicitar" })).not.toBeInTheDocument();
  });

  it("resumes every failed item of the request and updates the summary", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    extractionAction.mockResolvedValueOnce({ ok: true, status: "running", readerStatus: "queued" });
    render(<ExtractionHistory initialItems={rows()} />);
    openAll();

    await user.click(screen.getByRole("button", { name: "Reanudar fallidos" }));

    expect(extractionAction).toHaveBeenCalledTimes(1);
    expect(extractionAction).toHaveBeenCalledWith({ id: "b", action: "resume" });
    expect(await screen.findByText("1 extracciones reanudadas.")).toBeInTheDocument();
    expect(screen.getByText(/^En proceso · \d+ %$/)).toBeInTheDocument();
    expect(screen.getAllByText("En proceso", { selector: "span" })).toHaveLength(1);
    expect(screen.queryByText("Completada con incidencias", { selector: "span" })).not.toBeInTheDocument();
  });

  it("cancels only the active items of the request after confirmation", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    extractionAction.mockResolvedValue({ ok: true, status: "cancelled", readerStatus: "cancelled" });
    render(<ExtractionHistory initialItems={[
      item({ id: "x", requestGroupId: group, status: "running", canCancel: true }),
      item({ id: "y", requestGroupId: group, status: "completed", progress: 100, readerStatus: "completed" }),
      item({ id: "z", requestGroupId: group, status: "pending", canCancel: true, progress: 0, readerStatus: "queued" }),
    ]} />);
    openAll();

    await user.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
    await user.click(within(screen.getByRole("dialog", { name: "¿Cancelar la solicitud?" })).getByRole("button", { name: "Cancelar solicitud" }));

    expect(extractionAction.mock.calls.map(([call]) => call.id)).toEqual(["x", "z"]);
    expect(await screen.findByText("2 extracciones canceladas.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).not.toBeInTheDocument();
    extractionAction.mockReset();
  });
});

describe("request accordion", () => {
  const group = crypto.randomUUID();

  it("keeps the status on the header and hides the actions until the request is opened", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<ExtractionHistory initialItems={[item({ id: "f", requestGroupId: group, status: "failed", progress: null, canResume: true })]} />);

    const header = screen.getByRole("button", { name: /^AX-100/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(header).getByText("Fallida")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reanudar fallidos" })).not.toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Reanudar fallidos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a solicitar" })).toBeInTheDocument();

    header.focus();
    await user.keyboard("{Enter}");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Reanudar fallidos" })).not.toBeInTheDocument();
  });

  it("opens the request that was just created", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<ExtractionHistory createdId={group} initialItems={[item({ requestGroupId: group })]} />);
    expect(screen.getByRole("button", { name: /^AX-100/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("does not animate the progress bars with a pulse", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    const { unmount } = render(<ExtractionHistory initialItems={[item({ requestGroupId: group, status: "running", progress: 40 })]} />);
    openAll();
    for (const bar of screen.getAllByRole("progressbar")) expect(bar.firstElementChild).not.toHaveClass("motion-safe:animate-pulse");
    unmount();

    render(<ExtractionHistory initialItems={[item({ requestGroupId: group, status: "completed", progress: 100, readerStatus: "completed" })]} />);
    openAll();
    expect(screen.getByRole("progressbar", { name: "Progreso de la solicitud AX-100" }).firstElementChild).not.toHaveClass("motion-safe:animate-pulse");
  });
});

describe("status polling", () => {
  it("ignores a polled update older than what is already shown", async () => {
    const id = crypto.randomUUID();
    const group = crypto.randomUUID();
    const current = item({ id, requestGroupId: group, progress: 60, updatedAt: "2026-10-20T12:00:10.000Z" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{ ...current, progress: 0, updatedAt: "2026-10-20T12:00:05.000Z" }])));
    render(<ExtractionHistory initialItems={[current]} />);
    openAll();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getAllByText("60%").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("0%")).toHaveLength(0);
  });
});

describe("opening a request from a link", () => {
  it("expands the request named by the link even when it is completed", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    const target = crypto.randomUUID();
    const other = crypto.randomUUID();
    render(<ExtractionHistory openId={target} initialItems={[
      item({ id: "t", requestGroupId: target, status: "completed", progress: 100, readerStatus: "completed" }),
      item({ id: "o", requestGroupId: other, axCode: "AX-OTHER", status: "completed", progress: 100, readerStatus: "completed" }),
    ]} />);
    expect(screen.getByRole("button", { name: /^AX-100/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^AX-OTHER/ })).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(`request-${target}`)).not.toBeNull();
  });
});
