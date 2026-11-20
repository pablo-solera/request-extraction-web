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
    {groups.length === 0 ? <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-sm text-zinc-600"><p>No hay solicitudes pendientes.</p><a className="mt-3 inline-flex min-h-11 items-center text-zinc-900 underline" href="/history">Consultar el historial</a></div> : <div className="space-y-4">{groups.map((row) => {
      const requestRows = row.rows;
      return <article className="rounded-xl border border-zinc-200 bg-white p-6" key={row.request.requestGroupId}>
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-mono text-sm font-semibold text-zinc-950" translate="no">{row.request.axCode}</h2><p className="mt-1 text-xs text-zinc-600">Edición IMC <span translate="no">{row.request.imcEdition}</span> · Finalización {formatSpanishDate(row.request.completion)}{row.request.developmentStart ? ` · Inicio de desarrollo ${formatSpanishDate(row.request.developmentStart)}` : ""} · <span translate="no">{row.request.manufacturerGroup} / {row.request.brand}</span></p><p className="mt-1 text-sm text-zinc-600">{identities.get(row.requester.id)?.name ?? "Usuario"} · {pluralizeModels(requestRows.length)}</p><time className="mt-1 block text-xs text-zinc-600" dateTime={row.request.createdAt.toISOString()}>{formatSpanishDate(row.request.createdAt)}</time></div><p className="min-w-0 break-words text-xs text-zinc-600">{requestRows.map((item) => item.extraction.modelDescription).join(", ")}</p></div>
        <ApprovalForm requestGroupId={row.request.requestGroupId} axCode={row.request.axCode} action={decideExtractionRequest} />
      </article>;
    })}{nextCursor ? <Link className={buttonStyles("secondary")} href={`/approvals?after=${encodeURIComponent(nextCursor.createdAt)}&afterId=${nextCursor.requestGroupId}`}>Ver más solicitudes</Link> : null}</div>}
  </div>;
}
