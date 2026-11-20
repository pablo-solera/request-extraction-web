"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TransformerPanel } from "@/components/extractions/transformer-panel";
import type { TransformerRequestInfo } from "@/lib/transformer/info";
import type { ExtractionListItem, ExtractionReaderDetail } from "@/lib/extractions/types";
import { formatSpanishDate, formatSpanishDateTime } from "@/lib/date-format";
import { retryableItems, summarizeRequest, type RequestAggregateStatus } from "@/lib/extractions/request-summary";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { useConfirm, type Confirm } from "@/components/ui/confirm-dialog";
import { PopoverMenu } from "@/components/ui/popover-menu";
import { extractionAction, extractionDetail, loadHistory } from "@/app/(dashboard)/history/actions";
import type { RequestCursor } from "@/lib/extractions/repository";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

const statusTones: Record<ExtractionListItem["status"], BadgeTone> = { pending: "pending", running: "running", completed: "success", failed: "danger", cancelled: "neutral" };
const statusLabels = { pending: "Pendiente", running: "En proceso", completed: "Completada", failed: "Fallida", cancelled: "Cancelada" };
const aggregateTones: Record<RequestAggregateStatus, BadgeTone> = {
  pending_approval: "pending",
  rejected: "danger",
  running: "running",
  completed: "success",
  completed_with_issues: "issue",
  failed: "danger",
  cancelled: "neutral",
};
const requestStatusLabels = { pending: "Pendiente de aprobación", approved: "Aprobada", rejected: "Rechazada" };

function readerStatusNotice(item: ExtractionListItem) {
  if (item.readerStatus === "queued") return "En cola";
  if (item.readerStatus === "paused") return "En pausa";
  if (item.readerStatus === "rate_limited" || item.readerStatus === "rate-limited") return item.manufacturerGroup === "BMW" ? "En pausa por límite de BMW" : item.manufacturerGroup === "Mercedes" ? "En pausa por límite de Mercedes-Benz" : "En pausa por límite del reader";
  if (item.readerStatus === "cancelling") return "Cancelando…";
  if (item.readerStalled) return "El reader no detecta actividad";
  return null;
}

function ExtractionActions({ confirm, item, detailsExpanded, onToggleDetails, onUpdated }: { confirm: Confirm; item: ExtractionListItem; detailsExpanded: boolean; onToggleDetails(itemId: string): void; onUpdated(itemId: string, update: Partial<ExtractionListItem>): void }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function run(action: "cancel" | "resume", force = false) {
    if (action === "cancel" && !await confirm({ title: "¿Cancelar la extracción?", description: `Se detendrá la extracción de ${item.modelDescription} de la solicitud ${item.axCode}. Quedará como cancelada y, si la necesitas, tendrás que volver a solicitarla.`, confirmLabel: "Cancelar extracción", cancelLabel: "Mantener" })) return;
    setBusy(true);
    setFeedback("");
    const result = await extractionAction({ id: item.id, action, force });
    setBusy(false);
    if (!result.ok) {
      setFeedback(result.message);
      return;
    }
    const status = result.status === "cancelled" ? "cancelled" : action === "resume" ? "running" : item.status;
    onUpdated(item.id, { status, readerStatus: result.readerStatus, readerStalled: false, errorMessage: null, updatedAt: new Date().toISOString() });
    setFeedback(action === "cancel" ? result.status === "cancelled" ? "Extracción cancelada." : "Cancelación solicitada." : "Reanudación solicitada.");
  }

  const hasMenu = item.canCancel || item.canForceResume || item.canViewDetails;
  const itemClass = "flex min-h-11 w-full items-center rounded-md px-3 text-left text-body hover:bg-canvas";
  return <div className="flex flex-col items-end gap-2">
    <div className="flex items-center gap-2">
      {item.downloadReady ? <a aria-label={`Descargar ZIP de ${item.modelCode}`} className={buttonStyles("secondary")} href={`/api/extractions/${item.id}/download`}>Descargar ZIP</a> : null}
      {item.canResume ? <button aria-label={`Reanudar extracción de ${item.modelCode}`} className={buttonStyles("secondary")} disabled={busy} onClick={() => void run("resume")} type="button">Reanudar</button> : null}
      {hasMenu ? <PopoverMenu
        panelClassName="w-56"
        panelLabel={`Acciones para ${item.axCode}`}
        trigger={<svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 20 20" width="20"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>}
        triggerClassName={buttonStyles("secondary", "min-w-11 px-0")}
        triggerDisabled={busy}
        triggerLabel={`Opciones para ${item.axCode}, ${item.modelDescription}, ${item.modelCode}`}
      >{(close) => <>
        {item.canViewDetails ? <button {...close} className={`${itemClass} text-ink`} onClick={() => onToggleDetails(item.id)} type="button">{detailsExpanded ? "Ocultar detalles" : "Ver detalles"}</button> : null}
        {item.canCancel ? <button {...close} className={`${itemClass} text-danger-ink`} onClick={() => void run("cancel")} type="button">Cancelar extracción</button> : null}
        {item.canForceResume ? <button {...close} className={`${itemClass} text-pending-ink`} onClick={() => void run("resume", true)} type="button">Reanudar a la fuerza</button> : null}
        {item.canForceResume ? <p className="px-3 pb-2 text-meta text-ink-muted">Recupera una extracción que el reader detecta atascada; conserva los typekeys ya completados.</p> : null}
      </>}</PopoverMenu> : null}
    </div>
    {busy ? <span className="text-body text-ink-muted" role="status">Procesando…</span> : null}
    {feedback ? <p className="max-w-56 text-right text-body text-ink-muted" role="status">{feedback}</p> : null}
  </div>;
}

function RequestActions({ confirm, items, onUpdated }: { confirm: Confirm; items: ExtractionListItem[]; onUpdated(itemId: string, update: Partial<ExtractionListItem>): void }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const cancellable = items.filter((item) => item.canCancel);
  const resumable = retryableItems(items).filter((item) => item.status === "failed" && item.canResume);
  const axCode = items[0]?.axCode ?? "";
  const canRepeat = items[0]?.requestStatus !== "pending" && items.every((item) => item.status !== "pending" && item.status !== "running");

  async function runAll(action: "cancel" | "resume", targets: ExtractionListItem[]) {
    if (action === "cancel" && !await confirm({ title: "¿Cancelar la solicitud?", description: `Se detendrán las ${targets.length} extracciones activas de la solicitud ${axCode}. Las ya completadas no se verán afectadas.`, confirmLabel: "Cancelar solicitud", cancelLabel: "Mantener" })) return;
    setBusy(true);
    setFeedback("");
    let succeeded = 0;
    for (const item of targets) {
      const result = await extractionAction({ id: item.id, action });
      if (!result.ok) continue;
      succeeded++;
      const status = result.status === "cancelled" ? "cancelled" : action === "resume" ? "running" : item.status;
      onUpdated(item.id, { status, readerStatus: result.readerStatus, readerStalled: false, errorMessage: null, ...(action === "cancel" ? { canCancel: false } : { canResume: false, canForceResume: false }), updatedAt: new Date().toISOString() });
    }
    setBusy(false);
    const verb = action === "cancel" ? "canceladas" : "reanudadas";
    setFeedback(succeeded === targets.length ? `${succeeded} extracciones ${verb}.` : `${succeeded} de ${targets.length} extracciones ${verb}; revisa las demás.`);
  }

  return <div className="flex flex-wrap items-center gap-2">
    {cancellable.length ? <button className={buttonStyles("danger")} disabled={busy} onClick={() => void runAll("cancel", cancellable)} type="button">Cancelar solicitud</button> : null}
    {resumable.length ? <button className={buttonStyles("secondary")} disabled={busy} onClick={() => void runAll("resume", resumable)} type="button">Reanudar fallidos</button> : null}
    {canRepeat ? <Link className={buttonStyles("secondary")} href={`/extractions?request=${encodeURIComponent(items[0]!.requestGroupId)}`}>Volver a solicitar</Link> : null}
    {busy ? <span className="text-body text-ink-muted" role="status">Procesando…</span> : null}
    {feedback ? <span className="text-body text-ink-muted" role="status">{feedback}</span> : null}
  </div>;
}

function visibleStatus(item: ExtractionListItem): { label: string; tone: BadgeTone } {
  if (item.status === "cancelled") return { label: statusLabels.cancelled, tone: "neutral" };
  if (item.requestStatus === "rejected") return { label: "Rechazada", tone: "danger" };
  if (item.requestStatus === "pending") return { label: requestStatusLabels.pending, tone: "pending" };
  return { label: statusLabels[item.status], tone: statusTones[item.status] };
}

const statusFilters: Array<{ value: RequestAggregateStatus; label: string }> = [
  { value: "running", label: "En proceso" },
  { value: "pending_approval", label: "Pendiente de aprobación" },
  { value: "completed", label: "Completada" },
  { value: "completed_with_issues", label: "Completada con incidencias" },
  { value: "failed", label: "Fallida" },
  { value: "rejected", label: "Rechazada" },
  { value: "cancelled", label: "Cancelada" },
];

function nounFor(manufacturerGroup: string) {
  return manufacturerGroup === "Renault" ? "familia" : manufacturerGroup === "Mercedes" ? "modelo" : "typekey";
}

function groupItems(items: ExtractionListItem[]) {
  const groups = new Map<string, ExtractionListItem[]>();
  for (const item of items) {
    const group = groups.get(item.requestGroupId);
    if (group) group.push(item);
    else groups.set(item.requestGroupId, [item]);
  }
  return groups;
}

function mergeUpdates(current: ExtractionListItem[], incoming: ExtractionListItem[]) {
  const byId = new Map(incoming.map((item) => [item.id, item]));
  return current.map((item) => {
    const updated = byId.get(item.id);
    return updated && updated.updatedAt >= item.updatedAt ? updated : item;
  });
}

function ProgressBar({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return <div className={className}><div className="mb-1 flex justify-between text-meta text-ink-muted"><span>Progreso</span><span>{value}%</span></div><div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar"><div className="h-full rounded-full bg-focus transition-[width] duration-500" style={{ width: `${value}%` }} /></div></div>;
}

function ReaderDetail({ item, state }: { item: ExtractionListItem; state: { loading?: boolean; detail?: ExtractionReaderDetail; error?: string } | undefined }) {
  return <section aria-label={`Detalle de la extracción ${item.axCode}`} className="mt-3 rounded-lg border border-line-soft bg-surface p-4">
    {state?.loading ? <p className="text-body text-ink-muted" role="status">Cargando detalles del reader…</p> : null}
    {state?.error ? <p className="text-body text-danger-ink" role="alert">{state.error}</p> : null}
    {state?.detail ? <>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-body"><p><span className="font-semibold text-ink">Fase:</span> <span className="text-ink-secondary">{state.detail.stage ?? state.detail.status}</span></p><p><span className="font-semibold text-ink">Estado:</span> <span className="text-ink-secondary">{state.detail.status}</span></p>{state.detail.stalled ? <p className="font-medium text-pending-ink">El reader detecta la extracción atascada.</p> : null}</div>
      {state.detail.typekeys.length > 0 ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-meta"><thead className="text-ink-muted"><tr><th className="px-2 py-2 font-semibold">Typekey</th><th className="px-2 py-2 font-semibold">Familia</th><th className="px-2 py-2 font-semibold">Hojas completadas</th><th className="px-2 py-2 font-semibold">Pendientes</th><th className="px-2 py-2 font-semibold">Fallidas</th><th className="px-2 py-2 font-semibold">Grupos</th></tr></thead><tbody className="divide-y divide-line-soft">{state.detail.typekeys.map((typekey) => <tr key={typekey.typekey}><th className="px-2 py-2 font-mono font-medium text-ink">{typekey.typekey}</th><td className="px-2 py-2 text-ink-secondary">{typekey.family ?? "—"}</td><td className="px-2 py-2 tabular-nums text-ink-secondary">{typekey.completed ?? "—"}{typekey.total !== null ? ` / ${typekey.total}` : ""}</td><td className="px-2 py-2 tabular-nums text-ink-secondary">{typekey.remaining ?? "—"}</td><td className="px-2 py-2 tabular-nums text-ink-secondary">{typekey.failed ?? "—"}</td><td className="px-2 py-2 tabular-nums text-ink-secondary">{typekey.groups ?? "—"}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-meta text-ink-muted">El reader no ha proporcionado desglose por typekey.</p>}
    </> : null}
  </section>;
}

type HistoryProps = { createdId?: string; openId?: string; draftKey?: string; initialItems: ExtractionListItem[]; initialTransformer?: Record<string, TransformerRequestInfo>; initialNextCursor?: RequestCursor | null };

export function ExtractionHistory({ createdId, openId, draftKey = "extraction-draft-v1", initialItems, initialTransformer = {}, initialNextCursor = null }: HistoryProps) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [items, setItems] = useState(initialItems);
  const [transformer, setTransformer] = useState(initialTransformer);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [customized, setCustomized] = useState(false);
  const [previousInitialItems, setPreviousInitialItems] = useState(initialItems);
  const [refreshError, setRefreshError] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RequestAggregateStatus>("all");
  const [toggledGroups, setToggledGroups] = useState<Record<string, boolean>>({});
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [readerDetails, setReaderDetails] = useState<Record<string, { loading?: boolean; detail?: ExtractionReaderDetail; error?: string }>>({});
  const latestLoad = useRef(0);
  const debouncedSearch = useDebouncedValue(search.trim());
  if (initialItems !== previousInitialItems) {
    setPreviousInitialItems(initialItems);
    if (customized) setItems((current) => mergeUpdates(current, initialItems));
    else {
      setItems(initialItems);
      setNextCursor(initialNextCursor);
      setTransformer(initialTransformer);
    }
  }
  const refreshIds = items.filter((item) => item.status === "pending" || item.status === "running").map((item) => item.id);
  const activeKey = refreshIds.toSorted().join(",");

  useEffect(() => {
    if (openId) document.getElementById(`request-${openId}`)?.scrollIntoView?.({ block: "start" });
  }, [openId]);

  useEffect(() => {
    if (createdId) {
      localStorage.removeItem(draftKey);
      router.replace("/history", { scroll: false });
    }
  }, [createdId, draftKey, router]);

  useEffect(() => {
    if (debouncedSearch === appliedSearch) return;
    const requestId = ++latestLoad.current;
    void (async () => {
      setLoading(true);
      setLoadError("");
      const result = await loadHistory({ query: debouncedSearch });
      if (requestId !== latestLoad.current) return;
      setLoading(false);
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setAppliedSearch(debouncedSearch);
      setCustomized(debouncedSearch !== "");
      setItems(result.items);
      setNextCursor(result.nextCursor);
      setTransformer(result.transformer);
    })();
  }, [appliedSearch, debouncedSearch]);

  useEffect(() => {
    const ids = activeKey ? activeKey.split(",") : [];
    if (ids.length === 0) return;
    const controller = new AbortController();
    let timeout: number | undefined;
    let delay = 10_000;

    async function refresh() {
      if (document.visibilityState === "hidden") {
        timeout = window.setTimeout(refresh, 10_000);
        return;
      }
      try {
        const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, index * 100 + 100));
        const updates = (await Promise.all(batches.map(async (batch) => {
          const query = new URLSearchParams();
          for (const id of batch) query.append("id", id);
          const response = await fetch(`/api/extractions/status?${query.toString()}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error(`Status ${response.status}`);
          return await response.json() as ExtractionListItem[];
        }))).flat();
        const byId = new Map(updates.map((item) => [item.id, item]));
        startTransition(() => setItems((current) => {
          let changed = false;
          const next = current.map((item) => {
            const updated = byId.get(item.id);
            if (updated && updated.updatedAt >= item.updatedAt && (updated.status !== item.status || updated.requestStatus !== item.requestStatus || updated.updatedAt !== item.updatedAt || updated.progress !== item.progress || updated.readerStatus !== item.readerStatus || updated.readerStalled !== item.readerStalled || updated.canCancel !== item.canCancel || updated.canResume !== item.canResume || updated.canForceResume !== item.canForceResume || updated.downloadReady !== item.downloadReady)) {
              changed = true;
              return updated;
            }
            return item;
          });
          return changed ? next : current;
        }));
        setRefreshError(false);
        delay = 10_000;
      } catch {
        if (controller.signal.aborted) return;
        setRefreshError(true);
        delay = Math.min(delay * 2, 30_000);
      }
      timeout = window.setTimeout(refresh, delay);
    }

    void refresh();
    return () => {
      controller.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [activeKey]);

  const groups = groupItems(items);
  const summaries = new Map([...groups].map(([id, groupRows]) => {
    const first = groupRows[0]!;
    return [id, summarizeRequest(first.requestStatus, groupRows, nounFor(first.manufacturerGroup))] as const;
  }));
  const visibleGroups = [...groups].filter(([id]) => statusFilter === "all" || summaries.get(id)!.status === statusFilter);
  const filtered = statusFilter !== "all" || appliedSearch !== "";

  function updateItem(itemId: string, update: Partial<ExtractionListItem>) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...update } : item));
  }

  async function toggleReaderDetails(itemId: string) {
    if (openDetailId === itemId) {
      setOpenDetailId(null);
      return;
    }
    setOpenDetailId(itemId);
    setReaderDetails((current) => ({ ...current, [itemId]: { loading: true } }));
    const result = await extractionDetail(itemId);
    setReaderDetails((current) => ({ ...current, [itemId]: result.ok ? { detail: result.detail } : { error: result.message } }));
  }

  async function loadMore() {
    if (!nextCursor) return;
    const requestId = ++latestLoad.current;
    setLoading(true);
    setLoadError("");
    const result = await loadHistory({ cursor: nextCursor, query: appliedSearch });
    if (requestId !== latestLoad.current) return;
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message);
      return;
    }
    setCustomized(true);
    setItems((current) => {
      const known = new Set(current.map((item) => item.id));
      return [...current, ...result.items.filter((item) => !known.has(item.id))];
    });
    setNextCursor(result.nextCursor);
    setTransformer((current) => ({ ...current, ...result.transformer }));
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
  }

  if (items.length === 0 && !filtered && !search && !loading) {
    return <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center"><p className="text-body font-medium text-ink">Todavía no hay extracciones</p><p className="mt-2 text-body text-ink-muted">Crea una solicitud para verla aquí.</p><Link className={buttonStyles("primary", "mt-4")} href="/extractions">Nueva extracción</Link></div>;
  }

  const createdItems = createdId ? items.filter((item) => item.requestGroupId === createdId) : [];
  const hasPendingApproval = createdItems.some((item) => item.requestStatus === "pending");
  const summaryText = filtered
    ? `${visibleGroups.length} de ${groups.size} solicitudes cargadas${nextCursor ? ", hay más sin cargar" : ""}`
    : `${groups.size} ${groups.size === 1 ? "solicitud" : "solicitudes"}${nextCursor ? ", hay más sin cargar" : ""}`;

  return (
    <div className="space-y-4">
      {confirmDialog}
      {createdId ? <p className="rounded-xl border border-success-line bg-success-wash px-4 py-3 text-body text-success-ink" role="status">{hasPendingApproval ? "Solicitud enviada y pendiente de aprobación." : "Solicitud enviada correctamente."}</p> : null}
      {refreshError ? <p className="rounded-xl border border-pending-line bg-pending-wash px-4 py-3 text-body text-pending-ink" role="status">No se pudo actualizar el estado. Se volverá a intentar automáticamente.</p> : null}
      <p className="sr-only" aria-live="polite">{items.filter((item) => item.status === "completed" || item.status === "failed" || item.requestStatus === "approved" || item.requestStatus === "rejected").map((item) => `${item.axCode}: ${visibleStatus(item).label}`).join(". ")}</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="block min-w-64 max-w-sm flex-1"><span className="field-label">Buscar por código AX</span><input autoComplete="off" className="field-control" name="search" onChange={(event) => setSearch(event.target.value)} placeholder="Ej.: 1XF" spellCheck={false} type="search" value={search} /></label>
        <label className="block w-64"><span className="field-label">Estado</span><select className="field-control" name="status" onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} value={statusFilter}><option value="all">Todos los estados</option>{statusFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <p aria-live="polite" className="pb-3 text-body text-ink-muted" role="status">{summaryText}</p>
        {filtered || search ? <Button onClick={clearFilters} variant="ghost">Limpiar filtros</Button> : null}
      </div>
      {loadError ? <p className="rounded-xl border border-danger-line bg-danger-wash px-4 py-3 text-body text-danger-ink" role="alert">{loadError}</p> : null}
      {visibleGroups.length === 0 ? <p className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center text-body text-ink-muted">{loading ? "Buscando solicitudes…" : "Ninguna solicitud coincide con la búsqueda o el estado elegido."}</p> : null}
      <div aria-busy={loading} className="space-y-3">
        {visibleGroups.map(([groupId, groupRows]) => {
          const first = groupRows[0]!;
          const noun = nounFor(first.manufacturerGroup);
          const summary = summaries.get(groupId)!;
          const expanded = toggledGroups[groupId] ?? (groupId === createdId || groupId === openId);
          const panelId = `request-panel-${groupId}`;
          const hasProgress = summary.status !== "pending_approval" && summary.status !== "rejected";
          const running = summary.status === "running";
          return <section aria-label={`Solicitud ${first.axCode}`} className={`overflow-hidden rounded-xl border bg-surface [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto] ${groupId === createdId ? "border-success-line" : "border-line-soft"}`} id={`request-${groupId}`} key={groupId}>
            <h2 className="m-0">
              <button aria-controls={panelId} aria-expanded={expanded} className="grid w-full min-w-0 grid-cols-[minmax(7rem,auto)_auto_1fr_auto_auto_auto] items-center gap-x-4 px-5 py-3 text-left hover:bg-surface-sunken focus-visible:-outline-offset-2" onClick={() => setToggledGroups((current) => ({ ...current, [groupId]: !expanded }))} type="button">
                <span className="break-words font-mono text-code font-semibold text-ink-strong" translate="no">{first.axCode}</span>
                <Badge icon={false} tone="info"><span translate="no">{first.manufacturerGroup === first.brand ? first.brand : `${first.manufacturerGroup} / ${first.brand}`}</span></Badge>
                <span className="text-body text-ink-muted">{summary.total} {summary.total === 1 ? noun : `${noun}s`}</span>
                <Badge tone={aggregateTones[summary.status]}>{summary.label}{running ? ` · ${summary.progress} %` : ""}</Badge>
                <time className="text-meta text-ink-muted" dateTime={first.createdAt}>{formatSpanishDate(first.createdAt)}</time>
                <svg aria-hidden="true" className={`size-5 text-ink-muted transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </h2>
            {expanded ? <div className="border-t border-line-soft" id={panelId}>
              <div className="space-y-3 px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
                  <div><dt className="text-meta text-ink-muted">Edición IMC</dt><dd className="mt-0.5 text-body font-medium text-ink" translate="no">{first.imcEdition}</dd></div>
                  <div><dt className="text-meta text-ink-muted">Inicio del desarrollo</dt><dd className="mt-0.5 text-body font-medium text-ink">{first.developmentStart ? formatSpanishDate(first.developmentStart) : "—"}</dd></div>
                  <div><dt className="text-meta text-ink-muted">Completion</dt><dd className="mt-0.5 text-body font-medium text-ink">{formatSpanishDate(first.completion)}</dd></div>
                  <div><dt className="text-meta text-ink-muted">{noun === "familia" ? "Familias" : noun === "modelo" ? "Modelos" : "Typekeys"}</dt><dd className="mt-0.5 text-body font-medium text-ink">{groupRows.length}</dd></div>
                  <div><dt className="text-meta text-ink-muted">Solicitada</dt><dd className="mt-0.5 text-body font-medium text-ink"><time dateTime={first.createdAt}>{formatSpanishDateTime(first.createdAt)}</time>{first.requesterName ? ` · ${first.requesterName}` : ""}</dd></div>
                </dl>
                {hasProgress ? <>
                  <p className="text-body text-ink-secondary">{summary.description}</p>
                  <ProgressBar className="max-w-80" label={`Progreso de la solicitud ${first.axCode}`} value={summary.progress} />
                </> : null}
                <RequestActions confirm={confirm} items={groupRows} onUpdated={updateItem} />
                {first.manufacturerGroup === "BMW" || first.manufacturerGroup === "Mercedes" ? <TransformerPanel allCompleted={groupRows.every((item) => item.status === "completed")} initialInfo={transformer[groupId]} requestGroupId={groupId} /> : null}
              </div>
              <div className="divide-y divide-line-soft border-t border-line-soft bg-surface-sunken">
                {groupRows.map((item) => {
                  const status = visibleStatus(item);
                  const notice = readerStatusNotice(item);
                  return <article className="min-w-0 px-5 py-3" key={item.id}>
                    <div className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_auto] items-center gap-4">
                      <div className="min-w-0"><p className="break-words text-body font-medium text-ink">{item.modelDescription}</p><p className="mt-0.5 break-words text-meta text-ink-muted"><span translate="no">{item.manufacturerGroup} / {item.brand} · {item.modelCode}</span> · {item.domain}</p></div>
                      <div className="min-w-0"><Badge tone={status.tone}>{status.label}</Badge>{notice ? <p className="mt-1.5 text-meta font-medium text-pending-ink">{notice}</p> : null}{item.progress !== null && item.progress !== undefined && (item.status === "pending" || item.status === "running") ? <ProgressBar className="mt-2 max-w-56" label={`Progreso de ${item.axCode}`} value={item.progress} /> : null}{item.errorMessage ? <p className="mt-1.5 break-words text-meta text-danger-ink">{item.errorMessage}</p> : null}</div>
                      <ExtractionActions confirm={confirm} detailsExpanded={openDetailId === item.id} item={item} onToggleDetails={(id) => void toggleReaderDetails(id)} onUpdated={updateItem} />
                    </div>
                    {openDetailId === item.id ? <ReaderDetail item={item} state={readerDetails[item.id]} /> : null}
                  </article>;
                })}
              </div>
            </div> : null}
          </section>;
        })}
      </div>
      {nextCursor ? <div className="flex justify-center"><Button aria-busy={loading} disabled={loading} onClick={() => void loadMore()}>{loading ? "Cargando…" : "Cargar más solicitudes"}</Button></div> : null}
    </div>
  );
}
