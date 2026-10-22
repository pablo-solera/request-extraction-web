"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExtractionListItem, ExtractionReaderDetail } from "@/lib/extractions/types";
import { formatSpanishDate, formatSpanishDateTime } from "@/lib/date-format";
import { retryableItems, summarizeRequest, type RequestAggregateStatus } from "@/lib/extractions/request-summary";
import { extractionAction, extractionDetail } from "@/app/(dashboard)/history/actions";

const statusStyles = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  running: "border-sky-200 bg-sky-50 text-sky-800",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-800",
  cancelled: "border-zinc-300 bg-zinc-100 text-zinc-700",
};
const statusLabels = { pending: "Pendiente", running: "En proceso", completed: "Completada", failed: "Fallida", cancelled: "Cancelada" };
const aggregateStyles: Record<RequestAggregateStatus, string> = {
  pending_approval: statusStyles.pending,
  rejected: statusStyles.failed,
  running: statusStyles.running,
  completed: statusStyles.completed,
  completed_with_issues: statusStyles.pending,
  failed: statusStyles.failed,
  cancelled: statusStyles.cancelled,
};
const requestStatusLabels = { pending: "Pendiente de aprobación", approved: "Aprobada", rejected: "Rechazada" };

function readerStatusNotice(item: ExtractionListItem) {
  if (item.readerStatus === "queued") return "En cola";
  if (item.readerStatus === "paused") return "En pausa";
  if (item.readerStatus === "rate_limited" || item.readerStatus === "rate-limited") return item.manufacturerGroup === "BMW" ? "En pausa por límite de BMW" : "En pausa por límite del reader";
  if (item.readerStatus === "cancelling") return "Cancelando…";
  if (item.readerStalled) return "El reader no detecta actividad";
  return null;
}

function ExtractionActions({ item, detailsExpanded, onToggleDetails, onUpdated }: { item: ExtractionListItem; detailsExpanded: boolean; onToggleDetails(itemId: string): void; onUpdated(itemId: string, update: Partial<ExtractionListItem>): void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  async function run(action: "cancel" | "resume", force = false) {
    if (action === "cancel" && !window.confirm(`¿Cancelar la extracción ${item.axCode} · ${item.modelDescription}?`)) return;
    setBusy(true);
    setFeedback("");
    const result = await extractionAction({ id: item.id, action, force });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      setFeedback(result.message);
      return;
    }
    const status = result.status === "cancelled" ? "cancelled" : action === "resume" ? "running" : item.status;
    onUpdated(item.id, { status, readerStatus: result.readerStatus, readerStalled: false, errorMessage: null, updatedAt: new Date().toISOString() });
    setFeedback(action === "cancel" ? result.status === "cancelled" ? "Extracción cancelada." : "Cancelación solicitada." : "Reanudación solicitada.");
  }

  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 224;
      const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
      const top = window.innerHeight - rect.bottom < 260 ? Math.max(8, rect.top - 200) : rect.bottom + 4;
      setMenuPosition({ top, left });
    }
    setOpen(true);
  }

  const hasAction = item.canCancel || item.canResume || item.canForceResume || item.downloadReady || item.canRepeat || item.canViewDetails;
  return <div className="relative flex flex-col items-end gap-2" ref={containerRef}>
    <button aria-expanded={open} aria-label={`Opciones para ${item.axCode}, ${item.modelDescription}, ${item.modelCode}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:opacity-50" disabled={busy} onClick={toggleMenu} ref={triggerRef} type="button">
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 20 20" width="20"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>
    </button>
    {busy ? <span className="text-xs text-zinc-600" role="status">Procesando…</span> : null}
    {open ? <div className="fixed z-50 max-h-[70vh] min-w-52 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg" aria-label={`Acciones para ${item.axCode}`} style={menuPosition}>
      {item.downloadReady ? <a className="flex min-h-10 items-center rounded-md px-3 text-left text-sm text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-700" href={`/api/extractions/${item.id}/download`}>Descargar ZIP de {item.modelCode}</a> : null}
      {item.canRepeat ? <Link className="flex min-h-10 items-center rounded-md px-3 text-left text-sm text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-700" href={`/extractions?from=${encodeURIComponent(item.id)}`}>Volver a solicitar</Link> : null}
      {item.canViewDetails ? <button className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-700" onClick={() => { onToggleDetails(item.id); setOpen(false); }} type="button">{detailsExpanded ? "Ocultar detalles" : "Ver detalles"}</button> : null}
      {item.canCancel ? <button className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-700" onClick={() => void run("cancel")} type="button">Cancelar extracción</button> : null}
      {item.canResume ? <button className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-700" onClick={() => void run("resume")} type="button">Reanudar extracción</button> : null}
      {item.canForceResume ? <button className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm text-amber-900 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-amber-700" onClick={() => void run("resume", true)} type="button">Reanudar a la fuerza</button> : null}
      {item.canForceResume ? <p className="px-3 pb-2 text-xs leading-5 text-zinc-500">Recupera una extracción que el reader detecta atascada; conserva los typekeys ya completados.</p> : null}
      {!hasAction ? <p className="px-3 py-2 text-sm text-zinc-500">No hay acciones disponibles</p> : null}
    </div> : null}
    {feedback ? <p className="max-w-56 text-right text-xs text-zinc-600" role="status">{feedback}</p> : null}
  </div>;
}

function RequestActions({ items, onUpdated }: { items: ExtractionListItem[]; onUpdated(itemId: string, update: Partial<ExtractionListItem>): void }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const cancellable = items.filter((item) => item.canCancel);
  const resumable = retryableItems(items).filter((item) => item.status === "failed" && item.canResume);
  const axCode = items[0]?.axCode ?? "";
  const canRepeat = retryableItems(items).some((item) => item.canRepeat);

  async function runAll(action: "cancel" | "resume", targets: ExtractionListItem[]) {
    if (action === "cancel" && !window.confirm(`¿Cancelar las ${targets.length} extracciones activas de la solicitud ${axCode}?`)) return;
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

  const buttonClass = "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:opacity-50";
  return <div className="flex flex-wrap items-center gap-2">
    {cancellable.length ? <button className={`${buttonClass} border-red-200 bg-white text-red-700 hover:bg-red-50`} disabled={busy} onClick={() => void runAll("cancel", cancellable)} type="button">Cancelar solicitud</button> : null}
    {resumable.length ? <button className={`${buttonClass} border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`} disabled={busy} onClick={() => void runAll("resume", resumable)} type="button">Reanudar fallidos</button> : null}
    {canRepeat ? <Link className={`${buttonClass} border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`} href={`/extractions?request=${encodeURIComponent(items[0]!.requestGroupId)}`}>Volver a solicitar</Link> : null}
    {busy ? <span className="text-xs text-zinc-600" role="status">Procesando…</span> : null}
    {feedback ? <span className="text-xs text-zinc-600" role="status">{feedback}</span> : null}
  </div>;
}

function visibleStatus(item: ExtractionListItem) {
  if (item.status === "cancelled") return { label: statusLabels.cancelled, style: statusStyles.cancelled };
  if (item.requestStatus === "rejected") return { label: "Rechazada", style: statusStyles.failed };
  if (item.requestStatus === "pending") return { label: requestStatusLabels.pending, style: statusStyles.pending };
  return { label: statusLabels[item.status], style: statusStyles[item.status] };
}

export function ExtractionHistory({ createdId, draftKey = "extraction-draft-v1", initialItems }: { createdId?: string; draftKey?: string; initialItems: ExtractionListItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [previousInitialItems, setPreviousInitialItems] = useState(initialItems);
  const [refreshError, setRefreshError] = useState(false);
  const [toggledGroups, setToggledGroups] = useState<Record<string, boolean>>({});
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [readerDetails, setReaderDetails] = useState<Record<string, { loading?: boolean; detail?: ExtractionReaderDetail; error?: string }>>({});
  if (initialItems !== previousInitialItems) {
    setPreviousInitialItems(initialItems);
    setItems(initialItems);
  }
  const refreshIds = items.filter((item) => item.status === "pending" || item.status === "running").map((item) => item.id);
  const activeKey = refreshIds.toSorted().join(",");

  useEffect(() => {
    if (createdId) {
      localStorage.removeItem(draftKey);
      router.replace("/history", { scroll: false });
    }
  }, [createdId, draftKey, router]);

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

  if (items.length === 0) {
    return <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center"><p className="text-sm font-medium text-zinc-900">Todavía no hay extracciones</p><p className="mt-2 text-sm text-zinc-500">Crea una solicitud para verla aquí.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800" href="/extractions">Nueva extracción</Link></div>;
  }

  const groups: Array<{ id: string; items: ExtractionListItem[] }> = [];
  for (const item of items) {
    const group = groups.find((entry) => entry.id === item.requestGroupId);
    if (group) group.items.push(item);
    else groups.push({ id: item.requestGroupId, items: [item] });
  }
  const createdItems = createdId ? items.filter((item) => item.requestGroupId === createdId) : [];
  const hasPendingApproval = createdItems.some((item) => item.requestStatus === "pending");

  return (
    <div className="space-y-4">
      {createdId ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{hasPendingApproval ? "Solicitud enviada y pendiente de aprobación." : "Solicitud enviada correctamente."}</p> : null}
      {refreshError ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">No se pudo actualizar el estado. Se volverá a intentar automáticamente.</p> : null}
      <p className="sr-only" aria-live="polite">{items.filter((item) => item.status === "completed" || item.status === "failed" || item.requestStatus === "approved" || item.requestStatus === "rejected").map((item) => `${item.axCode}: ${visibleStatus(item).label}`).join(". ")}</p>
      <div className="space-y-4">
        {groups.map((group) => {
          const first = group.items[0]!;
          const noun = first.manufacturerGroup === "Renault" ? "familia" : "typekey";
          const summary = summarizeRequest(first.requestStatus, group.items, noun);
          const expanded = toggledGroups[group.id] ?? group.id === createdId;
          const panelId = `request-panel-${group.id}`;
          const hasProgress = summary.status !== "pending_approval" && summary.status !== "rejected";
          const running = summary.status === "running";
          return <section aria-label={`Solicitud ${first.axCode}`} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${group.id === createdId ? "border-emerald-300" : "border-zinc-200"}`} key={group.id}>
            <h2 className="m-0">
              <button aria-controls={panelId} aria-expanded={expanded} className="flex w-full min-w-0 items-center gap-4 px-5 py-5 text-left hover:bg-zinc-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-700 md:px-6" onClick={() => setToggledGroups((current) => ({ ...current, [group.id]: !expanded }))} type="button">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-mono text-sm font-semibold text-zinc-950" translate="no">{first.axCode}</span>
                  <span className="mt-1 block text-xs font-normal text-zinc-600">Edición IMC <span translate="no">{first.imcEdition}</span> · Finalización {formatSpanishDate(first.completion)}{first.developmentStart ? ` · Inicio de desarrollo ${formatSpanishDate(first.developmentStart)}` : ""}</span>
                  <span className="mt-1 block text-xs font-normal text-zinc-600"><span translate="no">{first.manufacturerGroup} / {first.brand}</span> · {group.items.length} {group.items.length === 1 ? noun : `${noun}s`} · <time dateTime={first.createdAt}>{formatSpanishDateTime(first.createdAt)}</time>{first.requesterName ? ` · ${first.requesterName}` : ""}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${aggregateStyles[summary.status]}`}>{summary.label}{running ? ` · ${summary.progress} %` : ""}</span>
                  <svg aria-hidden="true" className={`size-5 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              </button>
            </h2>
            {expanded ? <div className="border-t border-zinc-200" id={panelId}>
              <div className="space-y-3 px-5 py-4 md:px-6">
                {hasProgress ? <>
                  <p className="text-sm text-zinc-700">{summary.description}</p>
                  <div className="max-w-80"><div className="mb-1 flex justify-between text-xs text-zinc-600"><span>Progreso</span><span>{summary.progress}%</span></div><div aria-label={`Progreso de la solicitud ${first.axCode}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={summary.progress} className="h-2 overflow-hidden rounded-full bg-zinc-200" role="progressbar"><div className={`h-full rounded-full bg-sky-600 transition-[width] duration-500 ${running ? "motion-safe:animate-pulse" : ""}`} style={{ width: `${summary.progress}%` }} /></div></div>
                </> : null}
                <RequestActions items={group.items} onUpdated={updateItem} />
              </div>
              <div className="divide-y divide-zinc-200 border-t border-zinc-200 bg-zinc-50/50">
              {group.items.map((item) => {
            const status = visibleStatus(item);
            const detailState = readerDetails[item.id];
            return <article className={`min-w-0 px-5 py-4 md:px-6`} key={item.id}>
              <div className="grid min-w-0 gap-5 md:grid-cols-[1.6fr_1fr_auto] md:items-center">
              <div className="min-w-0"><p className="break-words text-sm font-medium text-zinc-900">{item.modelDescription}</p><p className="mt-1 break-words text-xs text-zinc-600"><span translate="no">{item.manufacturerGroup} / {item.brand} · {item.modelCode}</span> · {item.domain}</p></div>
              <div className="min-w-0"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${status.style}`}>{status.label}</span>{readerStatusNotice(item) ? <p className="mt-2 text-xs font-medium text-amber-800">{readerStatusNotice(item)}</p> : null}{item.progress !== null && item.progress !== undefined && (item.status === "pending" || item.status === "running") ? <div className="mt-3 max-w-56"><div className="mb-1 flex justify-between text-xs text-zinc-600"><span>Progreso</span><span>{item.progress}%</span></div><div aria-label={`Progreso de ${item.axCode}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={item.progress} className="h-2 overflow-hidden rounded-full bg-zinc-200" role="progressbar"><div className="h-full rounded-full bg-sky-600 transition-[width] duration-500 motion-safe:animate-pulse" style={{ width: `${item.progress}%` }} /></div></div> : null}{item.errorMessage ? <p className="mt-2 break-words text-xs text-red-700">{item.errorMessage}</p> : null}</div>
                <ExtractionActions item={item} detailsExpanded={openDetailId === item.id} onToggleDetails={(id) => void toggleReaderDetails(id)} onUpdated={updateItem} />
              </div>
              {openDetailId === item.id ? <section aria-label={`Detalle de la extracción ${item.axCode}`} className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                {detailState?.loading ? <p className="text-sm text-zinc-600" role="status">Cargando detalles del reader…</p> : null}
                {detailState?.error ? <p className="text-sm text-red-700" role="alert">{detailState.error}</p> : null}
                {detailState?.detail ? <>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><p><span className="font-semibold text-zinc-900">Fase:</span> <span className="text-zinc-700">{detailState.detail.stage ?? detailState.detail.status}</span></p><p><span className="font-semibold text-zinc-900">Estado:</span> <span className="text-zinc-700">{detailState.detail.status}</span></p>{detailState.detail.stalled ? <p className="font-medium text-amber-800">El reader detecta la extracción atascada.</p> : null}</div>
                  {detailState.detail.typekeys.length > 0 ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="text-zinc-500"><tr><th className="px-2 py-2 font-semibold">Typekey</th><th className="px-2 py-2 font-semibold">Familia</th><th className="px-2 py-2 font-semibold">Hojas completadas</th><th className="px-2 py-2 font-semibold">Pendientes</th><th className="px-2 py-2 font-semibold">Fallidas</th><th className="px-2 py-2 font-semibold">Grupos</th></tr></thead><tbody className="divide-y divide-zinc-200">{detailState.detail.typekeys.map((typekey) => <tr key={typekey.typekey}><th className="px-2 py-2 font-mono font-medium text-zinc-900">{typekey.typekey}</th><td className="px-2 py-2 text-zinc-700">{typekey.family ?? "—"}</td><td className="px-2 py-2 tabular-nums text-zinc-700">{typekey.completed ?? "—"}{typekey.total !== null ? ` / ${typekey.total}` : ""}</td><td className="px-2 py-2 tabular-nums text-zinc-700">{typekey.remaining ?? "—"}</td><td className="px-2 py-2 tabular-nums text-zinc-700">{typekey.failed ?? "—"}</td><td className="px-2 py-2 tabular-nums text-zinc-700">{typekey.groups ?? "—"}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-xs text-zinc-600">El reader no ha proporcionado desglose por typekey.</p>}
                </> : null}
              </section> : null}
            </article>;
              })}
              </div>
            </div> : null}
          </section>;
        })}
      </div>
    </div>
  );
}
