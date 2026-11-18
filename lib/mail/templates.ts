export type RequestSummary = {
  axCode: string;
  imcEdition: string;
  brand: string;
  typekeys: string[];
};

export type MailContent = { subject: string; text: string; html: string };

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

const typekeyList = (typekeys: string[]) => typekeys.join(", ");
const link = (url: string | null, label: string) => url
  ? { text: `${label}: ${url}`, html: `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>` }
  : { text: "", html: "" };

/** Sent to the requester when the data is loaded and the LST can be uploaded. */
export function loadCompletedMail(input: RequestSummary & { requesterName: string; url: string | null }): MailContent {
  const open = link(input.url, "Abrir la solicitud y subir el .LST");
  const request = `${input.axCode} · ${input.imcEdition}`;
  return {
    subject: `Extracción ${request} completada: ya puedes generar la comparativa`,
    text: [
      `Hola ${input.requesterName},`,
      "",
      `La extracción ${request} (${input.brand}) ha terminado y sus datos ya están cargados en BMW_Labour.`,
      `Typekeys: ${typekeyList(input.typekeys)}.`,
      "Ya puedes subir el listado .LST para generar la comparativa.",
      ...(open.text ? ["", open.text] : []),
    ].join("\n"),
    html: [
      `<p>Hola ${escapeHtml(input.requesterName)},</p>`,
      `<p>La extracción <strong>${escapeHtml(request)}</strong> (${escapeHtml(input.brand)}) ha terminado y sus datos ya están cargados en BMW_Labour.</p>`,
      `<p><strong>Typekeys:</strong> ${escapeHtml(typekeyList(input.typekeys))}</p>`,
      "<p>Ya puedes subir el listado .LST para generar la comparativa.</p>",
      open.html,
    ].join(""),
  };
}

export type SupportEvent = "extraction_failed" | "load_failed" | "comparison_failed" | "report_failed";

const supportTitles: Record<SupportEvent, string> = {
  extraction_failed: "La extracción ha terminado con typekeys fallidos",
  load_failed: "La carga en BMW_Labour ha fallado",
  comparison_failed: "La comparación con el .LST ha fallado",
  report_failed: "El informe Excel de Mercedes-Benz ha fallado",
};

/** Sent to the support mailbox when something went wrong; `details` lines must not contain secrets. */
export function supportMail(input: RequestSummary & { event: SupportEvent; requesterName: string; details: string[]; url: string | null }): MailContent {
  const request = `${input.axCode} · ${input.imcEdition}`;
  const open = link(input.url, "Abrir la solicitud");
  const title = supportTitles[input.event];
  return {
    subject: `[Extracciones] ${title}: ${request}`,
    text: [
      `${title}.`,
      "",
      `Solicitud: ${request} (${input.brand})`,
      `Solicitante: ${input.requesterName}`,
      `Typekeys: ${typekeyList(input.typekeys)}`,
      ...(input.details.length ? ["", "Detalle:", ...input.details.map((line) => `- ${line}`)] : []),
      ...(open.text ? ["", open.text] : []),
    ].join("\n"),
    html: [
      `<p><strong>${escapeHtml(title)}.</strong></p>`,
      `<p><strong>Solicitud:</strong> ${escapeHtml(request)} (${escapeHtml(input.brand)})<br><strong>Solicitante:</strong> ${escapeHtml(input.requesterName)}<br><strong>Typekeys:</strong> ${escapeHtml(typekeyList(input.typekeys))}</p>`,
      input.details.length ? `<p><strong>Detalle:</strong></p><ul>${input.details.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "",
      open.html,
    ].join(""),
  };
}
