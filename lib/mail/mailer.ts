import "server-only";

import nodemailer, { type SendMailOptions } from "nodemailer";

declare global {
  var __requestExtractionMailer: ReturnType<typeof nodemailer.createTransport> | undefined;
}

/** An empty variable counts as unset, so `.env` files with blank placeholders do not break the configuration. */
function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function isMailEnabled() {
  return env("MAIL_ENABLED") === "true";
}

export function getMailSettings() {
  return {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT") ?? 25),
    secure: env("SMTP_SECURE") === "true",
    from: env("SMTP_FROM") ?? "extracciones@audatex.es",
    supportTo: env("MAIL_SUPPORT_TO") ?? "DL-ESMA-D-Acciona@audatexdatos.es",
    redirectTo: env("MAIL_REDIRECT_TO"),
  };
}

/** Public URL of the application for links in emails; a bare host name gets https://. Null when not configured. */
export function applicationUrl(path: string) {
  const raw = env("APP_BASE_URL");
  if (!raw) return null;
  const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, "");
  return `${base}${path}`;
}

function getTransporter() {
  if (globalThis.__requestExtractionMailer) return globalThis.__requestExtractionMailer;
  const settings = getMailSettings();
  if (!settings.host || !Number.isInteger(settings.port) || settings.port <= 0) throw new Error("SMTP_HOST and a valid SMTP_PORT are required when MAIL_ENABLED=true.");
  // The internal relay accepts mail without authentication; nodemailer upgrades to STARTTLS when the server offers it.
  globalThis.__requestExtractionMailer = nodemailer.createTransport({ host: settings.host, port: settings.port, secure: settings.secure });
  return globalThis.__requestExtractionMailer;
}

export type OutgoingMail = Pick<SendMailOptions, "subject" | "text" | "html"> & { to: string };

/**
 * Sends one email. Returns false when mail is disabled. With MAIL_REDIRECT_TO set (development), every message goes
 * to that address instead, with the intended recipient in the subject.
 */
export async function sendMail(mail: OutgoingMail) {
  if (!isMailEnabled()) return false;
  const settings = getMailSettings();
  const redirected = Boolean(settings.redirectTo);
  await getTransporter().sendMail({
    from: settings.from,
    to: settings.redirectTo ?? mail.to,
    subject: redirected ? `[PRUEBA → ${mail.to}] ${mail.subject}` : mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return true;
}
