import type { ExtractionRequestStatus, ExtractionStatus } from "@/db/schema";

export type RequestSummaryItem = { status: ExtractionStatus; progress: number | null };
export type RequestAggregateStatus = "pending_approval" | "rejected" | "running" | "completed" | "completed_with_issues" | "failed" | "cancelled";

export const requestAggregateLabels: Record<RequestAggregateStatus, string> = {
  pending_approval: "Pendiente de aprobación",
  rejected: "Rechazada",
  running: "En proceso",
  completed: "Completada",
  completed_with_issues: "Completada con incidencias",
  failed: "Fallida",
  cancelled: "Cancelada",
};

export type RequestSummary = {
  status: RequestAggregateStatus;
  label: string;
  progress: number;
  total: number;
  counts: Record<ExtractionStatus, number>;
  description: string;
};

const plural = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm);

export function summarizeRequest(requestStatus: ExtractionRequestStatus, items: RequestSummaryItem[], noun: "typekey" | "familia" = "typekey"): RequestSummary {
  const counts: Record<ExtractionStatus, number> = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const item of items) counts[item.status]++;
  const total = items.length;

  let status: RequestAggregateStatus;
  if (requestStatus === "pending") status = "pending_approval";
  else if (requestStatus === "rejected") status = "rejected";
  else if (counts.pending + counts.running > 0) status = "running";
  else if (counts.completed === total && total > 0) status = "completed";
  else if (counts.completed > 0) status = "completed_with_issues";
  else if (counts.failed > 0) status = "failed";
  else status = "cancelled";

  const progress = total === 0 ? 0 : Math.round(items.reduce((sum, item) => sum + (item.status === "completed" ? 100 : Math.min(100, Math.max(0, item.progress ?? 0))), 0) / total);

  const nouns = noun === "typekey" ? ["typekey", "typekeys"] as const : ["familia", "familias"] as const;
  const completedWord = noun === "typekey" ? plural(total, "completado", "completados") : plural(total, "completada", "completadas");
  const parts = [`${counts.completed} de ${total} ${plural(total, nouns[0], nouns[1])} ${completedWord}`];
  if (counts.failed) parts.push(`${counts.failed} ${plural(counts.failed, noun === "typekey" ? "fallido" : "fallida", noun === "typekey" ? "fallidos" : "fallidas")}`);
  if (counts.cancelled) parts.push(`${counts.cancelled} ${plural(counts.cancelled, noun === "typekey" ? "cancelado" : "cancelada", noun === "typekey" ? "cancelados" : "canceladas")}`);

  return { status, label: requestAggregateLabels[status], progress, total, counts, description: parts.join(" · ") };
}

export function retryableItems<T extends { status: ExtractionStatus }>(items: T[]): T[] {
  return items.filter((item) => item.status === "failed" || item.status === "cancelled");
}
