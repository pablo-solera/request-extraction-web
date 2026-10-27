import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNotification: vi.fn(), markNotificationSent: vi.fn(), markNotificationFailed: vi.fn(), markNotificationSkipped: vi.fn(), listRetryableNotifications: vi.fn(),
  getRequestWithRequester: vi.fn(), getComparison: vi.fn(),
  listRequestExtractions: vi.fn(), resolveUserIdentities: vi.fn(),
  isMailEnabled: vi.fn(), sendMail: vi.fn(),
}));

vi.mock("@/lib/mail/repository", () => ({
  claimNotification: mocks.claimNotification, markNotificationSent: mocks.markNotificationSent, markNotificationFailed: mocks.markNotificationFailed,
  markNotificationSkipped: mocks.markNotificationSkipped, listRetryableNotifications: mocks.listRetryableNotifications,
}));
vi.mock("@/lib/transformer/repository", () => ({ getRequestWithRequester: mocks.getRequestWithRequester, getComparison: mocks.getComparison }));
vi.mock("@/lib/extractions/repository", () => ({ listRequestExtractions: mocks.listRequestExtractions }));
vi.mock("@/lib/employees/identity-service", () => ({ resolveUserIdentities: mocks.resolveUserIdentities }));
vi.mock("@/lib/mail/mailer", () => ({
  isMailEnabled: mocks.isMailEnabled, sendMail: mocks.sendMail,
  getMailSettings: () => ({ supportTo: "soporte@audatex.es" }),
  applicationUrl: (path: string) => `https://app.example${path}`,
}));

import { notifyComparisonFailed, notifyExtractionFailures, notifyLoadCompleted, notifyLoadFailed, retryPendingNotifications } from "@/lib/mail/notifications";

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
    mocks.markNotificationSkipped.mockResolvedValue(undefined);
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
    expect(mocks.markNotificationSkipped).toHaveBeenCalledWith("n1");
    expect(mocks.markNotificationFailed).not.toHaveBeenCalled();
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

  describe("retrying notifications left behind", () => {
    const stored = (kind: string, ref: string, extra: Record<string, unknown> = {}) => ({ id: `row-${kind}`, requestGroupId: "g1", kind, ref, status: "failed", attempts: 1, ...extra });

    it("sends again what failed, rebuilding the details from the request", async () => {
      mocks.listRetryableNotifications.mockResolvedValueOnce([stored("load_completed", "load-1"), stored("load_failed", "load-2"), stored("comparison_failed", "cmp-1")]);
      mocks.getRequestWithRequester
        .mockResolvedValueOnce({ request: { loadStatus: "completed", loadRemoteId: "load-1", loadError: null } })
        .mockResolvedValueOnce({ request: { loadStatus: "failed", loadRemoteId: "load-2", loadError: "SQL no disponible" } })
        .mockResolvedValueOnce({ request: { loadStatus: "completed", loadRemoteId: "load-9", loadError: null } });
      mocks.getComparison.mockResolvedValueOnce({ errorMessage: "LST no válido" });

      expect(await retryPendingNotifications()).toBe(3);
      expect(mocks.sendMail).toHaveBeenCalledTimes(3);
      expect(mocks.sendMail.mock.calls[1]![0].text).toContain("- Error: SQL no disponible");
      expect(mocks.sendMail.mock.calls[2]![0].text).toContain("- Error: LST no válido");
    });

    it("skips a completed-load notice whose load was replaced since and unknown kinds", async () => {
      mocks.listRetryableNotifications.mockResolvedValueOnce([stored("load_completed", "old-load"), stored("something_else", "x")]);
      mocks.getRequestWithRequester.mockResolvedValue({ request: { loadStatus: "completed", loadRemoteId: "new-load", loadError: null } });
      expect(await retryPendingNotifications()).toBe(0);
      expect(mocks.markNotificationSkipped).toHaveBeenCalledWith("row-load_completed");
      expect(mocks.markNotificationSkipped).toHaveBeenCalledWith("row-something_else");
      expect(mocks.sendMail).not.toHaveBeenCalled();
    });

    it("does nothing while mail is disabled", async () => {
      mocks.isMailEnabled.mockReturnValue(false);
      expect(await retryPendingNotifications()).toBe(0);
      expect(mocks.listRetryableNotifications).not.toHaveBeenCalled();
    });
  });
});
