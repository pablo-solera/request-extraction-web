"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatSpanishDateTime } from "@/lib/date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TransformerComparisonInfo, TransformerRequestInfo } from "@/lib/transformer/info";

const POLL_MS = 5_000;
const comparisonLabels = { queued: "En cola", running: "Comparando", completed: "Lista", failed: "Fallida" } as const;
const comparisonTones = { queued: "pending", running: "running", completed: "success", failed: "danger" } as const;

function isActive(info: TransformerRequestInfo | undefined, allCompleted: boolean) {
  if (!info?.applicable) return false;
  if (info.kind === "mercedes") return info.report?.status === "queued" || info.report?.status === "running" || (info.report?.status === null && allCompleted);
  return info.loadStatus === "queued" || info.loadStatus === "running"
    || (info.loadStatus === null && allCompleted)
    || info.comparisons.some((comparison) => comparison.status === "queued" || comparison.status === "running");
}

function ReportSection({ allCompleted, busy, info, onRetry, requestGroupId }: { allCompleted: boolean; busy: boolean; info: TransformerRequestInfo; onRetry(): void; requestGroupId: string }) {
  const report = info.report;
  const status = report?.status ?? null;
  const download = report?.downloadReady ? <a className="text-body font-medium text-sky-800 underline underline-offset-2" href={`/api/requests/${requestGroupId}/report/download`}>Descargar Excel</a> : null;
  return <section aria-label="Informe Excel" className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
    <h3 className="text-body font-semibold text-zinc-950">Informe Excel</h3>
    {!allCompleted && status === null ? <p className="text-body text-zinc-600">El informe se generará cuando todos los modelos estén completados.</p> : null}
    {status === null && allCompleted ? <p className="text-body text-sky-800" role="status">{report && report.attempts > 0 ? "Reintentando generar el informe…" : "Preparando el informe…"}</p> : null}
    {status === "queued" || status === "running" ? <p className="text-body text-sky-800" role="status">Generando el informe Excel…</p> : null}
    {status === "completed" ? <p className="flex flex-wrap items-center gap-x-3 text-body text-emerald-800">Informe listo{report?.completedAt ? ` el ${formatSpanishDateTime(report.completedAt)}` : ""}. {download}</p> : null}
    {status === "failed" ? <div className="space-y-2" role="alert">
      <p className="text-body text-red-700">El informe ha fallado{report?.error ? `: ${report.error}` : "."}</p>
      {download ? <p className="text-body text-zinc-700">El Excel se llegó a generar y se puede descargar. {download}</p> : null}
      {report?.canRetry ? <Button disabled={busy} onClick={onRetry}>Reintentar informe</Button> : null}
    </div> : null}
  </section>;
}

function ComparisonRow({ comparison }: { comparison: TransformerComparisonInfo }) {
  return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-body">
    <span className="min-w-0 break-all font-mono text-code text-zinc-800">{comparison.filename}</span>
    <time className="text-meta text-zinc-500" dateTime={comparison.createdAt}>{formatSpanishDateTime(comparison.createdAt)}</time>
    <Badge tone={comparisonTones[comparison.status]}>{comparisonLabels[comparison.status]}</Badge>
    {comparison.downloadReady ? <a className="text-body font-medium text-sky-800 underline underline-offset-2" href={`/api/comparisons/${comparison.id}/download`}>Descargar Excel</a> : null}
    {comparison.error ? <span className="w-full break-words text-body text-danger-ink">{comparison.error}</span> : null}
  </li>;
}

export function TransformerPanel({ allCompleted, initialInfo, requestGroupId }: { allCompleted: boolean; initialInfo?: TransformerRequestInfo; requestGroupId: string }) {
  const [info, setInfo] = useState(initialInfo);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const active = isActive(info, allCompleted);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/requests/transformer?id=${encodeURIComponent(requestGroupId)}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const body = await response.json() as Record<string, TransformerRequestInfo>;
    if (body[requestGroupId]) setInfo(body[requestGroupId]);
  }, [requestGroupId]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timeout: number | undefined;
    async function tick() {
      try { await refresh(controller.signal); } catch { if (controller.signal.aborted) return; }
      timeout = window.setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      controller.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [active, refresh]);

  async function retryLoad() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/requests/${requestGroupId}/load/retry`, { method: "POST" });
      if (!response.ok) setError(((await response.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "No se ha podido reintentar la carga.");
      else await refresh();
    } catch { setError("No se ha podido reintentar la carga."); }
    setBusy(false);
  }

  async function retryReport() {
    setBusy(true);
    try {
      const response = await fetch(`/api/requests/${requestGroupId}/report/retry`, { method: "POST" });
      if (!response.ok) setError(((await response.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "No se ha podido reintentar el informe.");
      else { setError(""); await refresh(); }
    } catch { setError("No se ha podido reintentar el informe."); }
    setBusy(false);
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) { setError("Selecciona un fichero .LST o .ZIP."); return; }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/requests/${requestGroupId}/comparisons`, { method: "POST", body: form });
      if (!response.ok) setError(((await response.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "No se ha podido iniciar la comparación.");
      else {
        setMessage("Comparación iniciada. El Excel aparecerá en la lista cuando termine.");
        if (fileInput.current) fileInput.current.value = "";
        await refresh();
      }
    } catch { setError("No se ha podido subir el fichero."); }
    setBusy(false);
  }

  if (!info?.applicable) return null;
  if (info.kind === "mercedes") return <>
    <ReportSection allCompleted={allCompleted} busy={busy} info={info} onRetry={() => void retryReport()} requestGroupId={requestGroupId} />
    {error ? <p className="text-body text-red-700" role="alert">{error}</p> : null}
  </>;
  const loading = info.loadStatus === "queued" || info.loadStatus === "running" || (info.loadStatus === null && allCompleted);

  return <section aria-label="Carga en BMW_Labour y comparación" className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
    <h3 className="text-body font-semibold text-zinc-950">Carga en BMW_Labour y comparación</h3>
    {!allCompleted && info.loadStatus === null ? <p className="text-body text-zinc-600">Los datos se cargarán en BMW_Labour cuando todos los typekeys estén completados.</p> : null}
    {loading ? <p className="text-body text-sky-800" role="status">{info.loadStatus === null ? info.loadAttempts > 0 ? "Reintentando la carga en BMW_Labour…" : "Preparando la carga en BMW_Labour…" : "Cargando los datos en BMW_Labour…"}</p> : null}
    {info.loadStatus === "failed" ? <div className="space-y-2" role="alert">
      <p className="text-body text-red-700">La carga en BMW_Labour ha fallado{info.loadError ? `: ${info.loadError}` : "."}</p>
      {info.canRetryLoad ? <Button disabled={busy} onClick={() => void retryLoad()}>Reintentar carga</Button> : null}
    </div> : null}
    {info.loadStatus === "completed" ? <>
      <p className="text-body text-emerald-800">Datos cargados en BMW_Labour{info.loadedAt ? ` el ${formatSpanishDateTime(info.loadedAt)}` : ""}.</p>
      {info.canUpload ? <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void upload(event)}>
        <label className="min-w-0 flex-1 text-body text-zinc-800"><span className="mb-1 block text-meta font-medium text-zinc-600">Listado maestro (.LST o .ZIP)</span>
          <input accept=".lst,.zip" className="block w-full text-body file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:text-body file:font-medium" ref={fileInput} type="file" />
        </label>
        <Button disabled={busy} type="submit" variant="primary">{busy ? "Subiendo…" : "Comparar con .LST"}</Button>
      </form> : null}
    </> : null}
    {message ? <p className="text-body text-emerald-800" role="status">{message}</p> : null}
    {error ? <p className="text-body text-red-700" role="alert">{error}</p> : null}
    {info.comparisons.length ? <ul aria-label="Comparaciones" className="divide-y divide-zinc-100 border-t border-zinc-100">{info.comparisons.map((comparison) => <ComparisonRow comparison={comparison} key={comparison.id} />)}</ul> : null}
  </section>;
}
