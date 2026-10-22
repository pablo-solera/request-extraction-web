import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractionListItem } from "@/lib/extractions/types";

const replace = vi.fn();
const { extractionAction, extractionDetail } = vi.hoisted(() => ({ extractionAction: vi.fn(), extractionDetail: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/app/(dashboard)/history/actions", () => ({ extractionAction, extractionDetail }));

import { ExtractionHistory } from "@/components/extractions/extraction-history";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function item(overrides: Partial<ExtractionListItem> = {}): ExtractionListItem {
  return {
    id: crypto.randomUUID(),
    requestGroupId: crypto.randomUUID(),
    axCode: "AX-100",
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
    canRepeat: false,
    canViewDetails: false,
    ...overrides,
  };
}

describe("BMW extraction progress in history", () => {
  it("shows the reader percentage and pause notice with an accessible progress bar", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<ExtractionHistory initialItems={[item()]} />);

    expect(screen.getByText("En pausa por límite de BMW")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progreso de AX-100" })).toHaveAttribute("aria-valuenow", "45");
  });

  it("shows queue and paused notices without displaying a completed progress bar", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    render(<ExtractionHistory initialItems={[
      item({ id: "queued", axCode: "AX-Q", readerStatus: "queued", progress: 0 }),
      item({ id: "paused", axCode: "AX-P", readerStatus: "paused", progress: 30 }),
      item({ id: "completed", axCode: "AX-C", status: "completed", progress: 100, readerStatus: "completed" }),
    ]} />);

    expect(screen.getByText("En cola")).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progreso de AX-Q" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("progressbar", { name: "Progreso de AX-P" })).toHaveAttribute("aria-valuenow", "30");
    expect(screen.queryByRole("progressbar", { name: "Progreso de AX-C" })).not.toBeInTheDocument();
  });

  it("offers per-extraction actions in the accessible options menu and reports the result", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    extractionAction.mockResolvedValueOnce({ ok: true, status: "cancelled", readerStatus: "cancelled" });
    render(<ExtractionHistory initialItems={[item({ canCancel: true, canResume: true, progress: null })]} />);

    await user.click(screen.getAllByRole("button", { name: "Opciones para AX-100, X5 · G05, 41HZ" })[0]!);
    expect(screen.getByRole("button", { name: "Reanudar extracción" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar extracción" }));

    expect(extractionAction).toHaveBeenCalledWith({ id: expect.any(String), action: "cancel", force: false });
    expect(await screen.findByText("Extracción cancelada.")).toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
  });

  it("loads authorized per-typekey reader details and offers repeat for terminal rows", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    extractionDetail.mockResolvedValueOnce({ ok: true, detail: { status: "completed", stage: "completed", progress: 100, stalled: false, typekeys: [{ typekey: "41HZ", series: "X", family: "G05", completed: 2785, total: 2785, remaining: 0, failed: 0, groups: 34 }] } });
    render(<ExtractionHistory initialItems={[item({ status: "failed", progress: null, canRepeat: true, canViewDetails: true })]} />);

    await user.click(screen.getAllByRole("button", { name: "Opciones para AX-100, X5 · G05, 41HZ" })[0]!);
    expect(screen.getByRole("link", { name: "Volver a solicitar" })).toHaveAttribute("href", expect.stringContaining("from="));
    await user.click(screen.getByRole("button", { name: "Ver detalles" }));

    expect(extractionDetail).toHaveBeenCalledWith(expect.any(String));
    expect(await screen.findByRole("region", { name: "Detalle de la extracción AX-100" })).toBeInTheDocument();
    expect(screen.getByText("2785 / 2785")).toBeInTheDocument();
  });
});
