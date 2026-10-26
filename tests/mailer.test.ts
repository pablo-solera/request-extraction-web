// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));

import { applicationUrl, getMailSettings, isMailEnabled, sendMail } from "@/lib/mail/mailer";

const names = ["MAIL_ENABLED", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_FROM", "MAIL_SUPPORT_TO", "MAIL_REDIRECT_TO", "APP_BASE_URL"];

describe("mailer", () => {
  beforeEach(() => {
    for (const name of names) vi.stubEnv(name, "");
    mocks.sendMail.mockReset().mockResolvedValue({});
    mocks.createTransport.mockReset().mockReturnValue({ sendMail: mocks.sendMail });
    globalThis.__requestExtractionMailer = undefined;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does nothing unless MAIL_ENABLED is exactly true", async () => {
    expect(isMailEnabled()).toBe(false);
    expect(await sendMail({ to: "a@x.es", subject: "s", text: "t" })).toBe(false);
    vi.stubEnv("MAIL_ENABLED", "yes");
    expect(await sendMail({ to: "a@x.es", subject: "s", text: "t" })).toBe(false);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("sends through the relay without authentication and uses the extractions sender by default", async () => {
    vi.stubEnv("MAIL_ENABLED", "true");
    vi.stubEnv("SMTP_HOST", "relay.internal");
    expect(await sendMail({ to: "tecnico@audatex.es", subject: "Asunto", text: "Texto", html: "<p>Texto</p>" })).toBe(true);

    expect(mocks.createTransport).toHaveBeenCalledWith({ host: "relay.internal", port: 25, secure: false });
    expect(mocks.sendMail).toHaveBeenCalledWith({ from: "extracciones@audatex.es", to: "tecnico@audatex.es", subject: "Asunto", text: "Texto", html: "<p>Texto</p>" });
    await sendMail({ to: "otro@audatex.es", subject: "Otro", text: "t" });
    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
  });

  it("treats blank variables as unset and reads an explicit port, sender and TLS flag", () => {
    expect(getMailSettings()).toMatchObject({ host: undefined, port: 25, secure: false, from: "extracciones@audatex.es", supportTo: "DL-ESMA-D-Acciona@audatexdatos.es", redirectTo: undefined });
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_SECURE", "true");
    vi.stubEnv("SMTP_FROM", "otro@audatex.es");
    vi.stubEnv("MAIL_SUPPORT_TO", "soporte@audatex.es");
    expect(getMailSettings()).toMatchObject({ port: 587, secure: true, from: "otro@audatex.es", supportTo: "soporte@audatex.es" });
  });

  it("redirects every message in development and names the intended recipient in the subject", async () => {
    vi.stubEnv("MAIL_ENABLED", "true");
    vi.stubEnv("SMTP_HOST", "relay.internal");
    vi.stubEnv("MAIL_REDIRECT_TO", "yo@audatex.es");
    await sendMail({ to: "tecnico@audatex.es", subject: "Asunto", text: "t" });
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "yo@audatex.es", subject: "[PRUEBA → tecnico@audatex.es] Asunto" }));
  });

  it("refuses to send without an SMTP host", async () => {
    vi.stubEnv("MAIL_ENABLED", "true");
    await expect(sendMail({ to: "a@x.es", subject: "s", text: "t" })).rejects.toThrow("SMTP_HOST");
  });

  it("builds links from APP_BASE_URL, adding https:// to a bare host name", () => {
    expect(applicationUrl("/history")).toBeNull();
    vi.stubEnv("APP_BASE_URL", "request-extraction-peuwaxprvdacc03.axadmin.net");
    expect(applicationUrl("/history?request=1")).toBe("https://request-extraction-peuwaxprvdacc03.axadmin.net/history?request=1");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000/");
    expect(applicationUrl("/history")).toBe("http://localhost:3000/history");
  });
});
