import { describe, expect, it } from "vitest";
import { escapeHtml, loadCompletedMail, supportMail } from "@/lib/mail/templates";

const summary = { axCode: "1AF", imcEdition: "01/0", brand: "MINI", typekeys: ["31BB", "21AF"] };

describe("mail templates", () => {
  it("tells the requester the data is loaded and links to the request", () => {
    const mail = loadCompletedMail({ ...summary, requesterName: "Ana Pérez", url: "https://app.example/history?request=abc" });
    expect(mail.subject).toBe("Extracción 1AF · 01/0 completada: ya puedes generar la comparativa");
    expect(mail.text).toContain("Hola Ana Pérez,");
    expect(mail.text).toContain("ya están cargados en BMW_Labour");
    expect(mail.text).toContain("Typekeys: 31BB, 21AF.");
    expect(mail.text).toContain("https://app.example/history?request=abc");
    expect(mail.html).toContain('<a href="https://app.example/history?request=abc">Abrir la solicitud y subir el .LST</a>');
  });

  it("leaves the link out when the application URL is not configured", () => {
    const mail = loadCompletedMail({ ...summary, requesterName: "Ana", url: null });
    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("<a ");
  });

  it("describes each failure for support with the request, requester and details", () => {
    const mail = supportMail({ ...summary, event: "load_failed", requesterName: "Ana Pérez", details: ["Error: SQL no disponible"], url: "https://app.example/history?request=abc" });
    expect(mail.subject).toBe("[Extracciones] La carga en BMW_Labour ha fallado: 1AF · 01/0");
    expect(mail.text).toContain("Solicitante: Ana Pérez");
    expect(mail.text).toContain("- Error: SQL no disponible");
    expect(supportMail({ ...summary, event: "extraction_failed", requesterName: "A", details: [], url: null }).subject).toContain("typekeys fallidos");
    expect(supportMail({ ...summary, event: "comparison_failed", requesterName: "A", details: [], url: null }).subject).toContain("comparación con el .LST ha fallado");
  });

  it("escapes user-controlled values in the HTML but not in the plain text", () => {
    const mail = supportMail({ ...summary, event: "load_failed", requesterName: '<img src=x onerror="alert(1)">', details: ["<script>x</script>"], url: 'https://app.example/?a="b"&c=<d>' });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(mail.html).toContain("&amp;c=&lt;d&gt;");
    expect(mail.text).toContain('<img src=x onerror="alert(1)">');
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
