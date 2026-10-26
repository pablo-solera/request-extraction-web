import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNotification: vi.fn(), markNotificationSent: vi.fn(), markNotificationFailed: vi.fn(),
  listRequestExtractions: vi.fn(), resolveUserIdentities: vi.fn(),
  isMailEnabled: vi.fn(), sendMail: vi.fn(),
}));

vi.mock("@/lib/mail/repository", () => ({ claimNotification: mocks.claimNotification, markNotificationSent: mocks.markNotificationSent, markNotificationFailed: mocks.markNotificationFailed }));
vi.mock("@/lib/extractions/repository", () => ({ listRequestExtractions: mocks.listRequestExtractions }));
vi.mock("@/lib/employees/identity-service", () => ({ resolveUserIdentities: mocks.resolveUserIdentities }));
vi.mock("@/lib/mail/mailer", () => ({
  isMailEnabled: mocks.isMailEnabled, sendMail: mocks.sendMail,
  getMailSettings: () => ({ supportTo: "soporte@audatex.es" }),
  applicationUrl: (path: string) => `https://app.example${path}`,
}));

import { notifyComparisonFailed, notifyExtractionFailures, notifyLoadCompleted, notifyLoadFailed } from "@/lib/mail/notifications";

const requester = { id: "u1", oracleEmpId: 1, fallbackName: null, fallbackEmail: null };
const row = (modelCode: string, status: string, extra: Record<string, unknown> = {}, requestStatus = "approved") => ({
  extraction: { id: `id-${modelCode}`, modelCode, status, axCode: "1AF", imcEdition: "01/0", brand: "MINI", errorCode: null, errorMessage: null, ...extra },
  requestStatus, requester,
});

describe("mail notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMailEnabled.mockReturnValue(true);
    mocks.claimNotification.mockResolvedValue({ id: "n1" });
    mocks.markNotificationFailed.mockResolvedValue(undefined);
    mocks.markNotificationSent.mockResolvedValue(undefined);
    mocks.sendMail.mockResolvedValue(true);
    mocks.listRequestExtractions.mockResolvedValue([row("31BB", "completed")]);
    mocks.resolveUserIdentities.mockResolvedValue(new Map([["u1", { name: "Ana Pérez", email: "ana@audatex.es", wdNumber: null }]]));
  });

  it("tells the requester the load is complete, once per load", async () => {
    expect(await notifyLoadCompleted("g1", "load-1")).toBe(true);
    expect(mocks.claimNotification).toHaveBeenCalledWith("g1", "load_completed", "load-1");
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@audatex.es", subject: "Extracción 1AF · 01/0 completada: ya puedes generar la comparativa" }));
    expect(mocks.sendMail.mock.calls[0]![0].text).toContain("https://app.example/history?request=g1");
    expect(mocks.markNotificationSent).toHaveBeenCalledWith("n1");

    mocks.claimNotification.mockResolvedValueOnce(null);
    expect(await notifyLoadCompleted("g1", "load-1")).toBe(false);
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and claims nothing while mail is disabled", async () => {
    mocks.isMailEnabled.mockReturnValue(false);
    expect(await notifyLoadCompleted("g1", "load-1")).toBe(false);
    expect(await notifyLoadFailed("g1", "load-1", "x")).toBe(false);
    expect(await notifyExtractionFailures("g1")).toBe(false);
    expect(mocks.claimNotification).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("keeps the notification retryable when the SMTP server fails, without logging addresses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error("550 ana@audatex.es rejected"), { code: "EENVELOPE" }));

    expect(await notifyLoadCompleted("g1", "load-1")).toBe(false);
    expect(mocks.markNotificationFailed).toHaveBeenCalledWith("n1");
    expect(mocks.markNotificationSent).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("ana@audatex.es");
    expect(log).toHaveBeenCalledWith("Mail notification load_completed failed (EENVELOPE).");
    log.mockRestore();
  });

  it("skips the requester email when the requester has no address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.resolveUserIdentities.mockResolvedValueOnce(new Map([["u1", { name: "Ana", email: null, wdNumber: null }]]));
    expect(await notifyLoadCompleted("g1", "load-1")).toBe(false);
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.markNotificationFailed).toHaveBeenCalledWith("n1");
    warn.mockRestore();
  });

  it("reports load and comparison failures to the support mailbox, not to the requester", async () => {
    await notifyLoadFailed("g1", "load-1", "SQL no disponible");
    expect(mocks.claimNotification).toHaveBeenLastCalledWith("g1", "load_failed", "load-1");
    expect(mocks.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ to: "soporte@audatex.es", subject: "[Extracciones] La carga en BMW_Labour ha fallado: 1AF · 01/0" }));
    expect(mocks.sendMail.mock.calls[0]![0].text).toContain("- Error: SQL no disponible");

    await notifyComparisonFailed("g1", "cmp-1", "LST no válido");
    expect(mocks.claimNotification).toHaveBeenLastCalledWith("g1", "comparison_failed", "cmp-1");
    expect(mocks.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ to: "soporte@audatex.es" }));
  });

  it("tells support about failed typekeys only once every typekey of the request has finished", async () => {
    mocks.listRequestExtractions.mockResolvedValueOnce([row("31BB", "failed", { errorMessage: "BMW no disponible" }), row("21AF", "running")]);
    expect(await notifyExtractionFailures("g1")).toBe(false);
    expect(mocks.claimNotification).not.toHaveBeenCalled();

    mocks.listRequestExtractions.mockResolvedValue([row("31BB", "failed", { errorMessage: "BMW no disponible" }), row("21AF", "completed")]);
    expect(await notifyExtractionFailures("g1")).toBe(true);
    expect(mocks.claimNotification).toHaveBeenCalledWith("g1", "extraction_failed", "id-31BB");
    const mail = mocks.sendMail.mock.calls[0]![0];
    expect(mail.to).toBe("soporte@audatex.es");
    expect(mail.text).toContain("- 31BB: BMW no disponible");
    expect(mail.text).not.toContain("- 21AF");
  });

  it("ignores rejected requests, cancelled typekeys and requests awaiting approval", async () => {
    mocks.listRequestExtractions.mockResolvedValueOnce([row("31BB", "failed", { errorCode: "REQUEST_REJECTED" }, "rejected")]);
    expect(await notifyExtractionFailures("g1")).toBe(false);
    mocks.listRequestExtractions.mockResolvedValueOnce([row("31BB", "failed", { errorCode: "REQUEST_REJECTED" })]);
    expect(await notifyExtractionFailures("g1")).toBe(false);
    mocks.listRequestExtractions.mockResolvedValueOnce([row("31BB", "cancelled"), row("21AF", "completed")]);
    expect(await notifyExtractionFailures("g1")).toBe(false);
    mocks.listRequestExtractions.mockResolvedValueOnce([row("31BB", "failed", {}, "pending")]);
    expect(await notifyExtractionFailures("g1")).toBe(false);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
