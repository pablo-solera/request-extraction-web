import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { requireUser } from "@/lib/auth/guards";
import { resolveUserIdentities } from "@/lib/employees/identity-service";
import { listPendingRequests } from "@/lib/extractions/repository";
import { buttonStyles } from "@/components/ui/button";
import { decideExtractionRequest } from "./actions";
import { ApprovalForm } from "@/components/extractions/approval-form";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requestCursorSchema } from "@/lib/extractions/cursor";
import { pluralizeModels } from "@/lib/extractions/presentation";
import { formatSpanishDate } from "@/lib/date-format";

export const metadata: Metadata = { title: "Aprobaciones" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ after?: string; afterId?: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "coordinator") redirect("/extractions");
  const { after, afterId } = await searchParams;
  const parsedCursor = requestCursorSchema.safeParse({ createdAt: after, requestGroupId: afterId });
  const cursor = parsedCursor.success ? parsedCursor.data : null;
  const { rows, nextCursor } = await listPendingRequests(user.id, user.role === "admin", { cursor });
  const rowsByGroup = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = rowsByGroup.get(row.request.requestGroupId) ?? [];
    group.push(row);
    rowsByGroup.set(row.request.requestGroupId, group);
  }
  const groups = [...rowsByGroup.entries()].map(([requestGroupId, requestRows]) => ({ requestGroupId, rows: requestRows, ...requestRows[0] }));
  const identities = await resolveUserIdentities(rows.map((row) => row.requester));
  return <div className="space-y-7">
    <PageHeader><PageHeader.Title>Aprobaciones</PageHeader.Title><PageHeader.Description>Revisa solicitudes completas antes de enviarlas al reader.</PageHeader.Description></PageHeader>
    {groups.length === 0 ? <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center text-body text-ink-muted"><p>{cursor ? "No quedan más solicitudes pendientes en esta página." : "No hay solicitudes pendientes."}</p><Link className="mt-3 inline-flex min-h-11 items-center text-ink underline underline-offset-2" href={cursor ? "/approvals" : "/history"}>{cursor ? "Volver a la primera página" : "Consultar el historial"}</Link></div> : <div className="space-y-4">{groups.map((row) => {
      const requestRows = row.rows;
      return <article className="rounded-xl border border-line-soft bg-surface p-6" key={row.request.requestGroupId}>
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-mono text-code font-semibold text-ink-strong" translate="no">{row.request.axCode}</h2><p className="mt-1 text-body text-ink-muted">Edición IMC <span translate="no">{row.request.imcEdition}</span> · Finalización {formatSpanishDate(row.request.completion)}{row.request.developmentStart ? ` · Inicio de desarrollo ${formatSpanishDate(row.request.developmentStart)}` : ""} · <span translate="no">{row.request.manufacturerGroup} / {row.request.brand}</span></p><p className="mt-1 text-body text-ink-muted">{identities.get(row.requester.id)?.name ?? "Usuario"}</p><time className="mt-1 block text-meta text-ink-muted" dateTime={row.request.createdAt.toISOString()}>{formatSpanishDate(row.request.createdAt)}</time></div><div className="min-w-0 max-w-sm"><p className="text-meta font-medium text-ink-muted">{pluralizeModels(requestRows.length)}</p><ul aria-label={`Modelos de la solicitud ${row.request.axCode}`} className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-body text-ink-secondary" tabIndex={0}>{requestRows.map((item) => <li className="break-words" key={item.extraction.id}>{item.extraction.modelDescription}</li>)}</ul></div></div>
        <ApprovalForm requestGroupId={row.request.requestGroupId} axCode={row.request.axCode} action={decideExtractionRequest} />
      </article>;
    })}{cursor || nextCursor ? <nav aria-label="Paginación" className="flex flex-wrap gap-2">{cursor ? <Link className={buttonStyles("secondary")} href="/approvals">Volver a la primera página</Link> : null}{nextCursor ? <Link className={buttonStyles("secondary")} href={`/approvals?after=${encodeURIComponent(nextCursor.createdAt)}&afterId=${nextCursor.requestGroupId}`}>Ver más solicitudes</Link> : null}</nav> : null}</div>}
  </div>;
}
