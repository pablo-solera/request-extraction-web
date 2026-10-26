"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatSpanishDateTime } from "@/lib/date-format";
import type { TransformerComparisonInfo, TransformerRequestInfo } from "@/lib/transformer/info";

const POLL_MS = 5_000;
const comparisonLabels = { queued: "En cola", running: "Comparando", completed: "Lista", failed: "Fallida" } as const;
const comparisonStyles = {
  queued: "border-amber-200 bg-amber-50 text-amber-800",
  running: "border-sky-200 bg-sky-50 text-sky-800",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-800",
} as const;
const buttonClass = "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:opacity-50";

function isActive(info: TransformerRequestInfo | undefined, allCompleted: boolean) {
  if (!info?.applicable) return false;
  return info.loadStatus === "queued" || info.loadStatus === "running"
    || (info.loadStatus === null && allCompleted)
    || info.comparisons.some((comparison) => comparison.status === "queued" || comparison.status === "running");
}

function ComparisonRow({ comparison }: { comparison: TransformerComparisonInfo }) {
  return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
    <span className="min-w-0 break-all font-mono text-xs text-zinc-800">{comparison.filename}</span>
    <time className="text-xs text-zinc-500" dateTime={comparison.createdAt}>{formatSpanishDateTime(comparison.createdAt)}</time>
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${comparisonStyles[comparison.status]}`}>{comparisonLabels[comparison.status]}</span>
    {comparison.downloadReady ? <a className="text-sm font-medium text-sky-800 underline underline-offset-2" href={`/api/comparisons/${comparison.id}/download`}>Descargar Excel</a> : null}
    {comparison.error ? <span className="w-full break-words text-xs text-red-700">{comparison.error}</span> : null}
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
  const loading = info.loadStatus === "queued" || info.loadStatus === "running" || (info.loadStatus === null && allCompleted);

  return <section aria-label="Carga en BMW_Labour y comparación" className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-zinc-950">Carga en BMW_Labour y comparación</h3>
    {!allCompleted && info.loadStatus === null ? <p className="text-sm text-zinc-600">Los datos se cargarán en BMW_Labour cuando todos los typekeys estén completados.</p> : null}
    {loading ? <p className="text-sm text-sky-800" role="status">{info.loadStatus === null ? "Preparando la carga en BMW_Labour…" : "Cargando los datos en BMW_Labour…"}</p> : null}
    {info.loadStatus === "failed" ? <div className="space-y-2" role="alert">
      <p className="text-sm text-red-700">La carga en BMW_Labour ha fallado{info.loadError ? `: ${info.loadError}` : "."}</p>
      {info.canRetryLoad ? <button className={`${buttonClass} border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`} disabled={busy} onClick={() => void retryLoad()} type="button">Reintentar carga</button> : null}
    </div> : null}
    {info.loadStatus === "completed" ? <>
      <p className="text-sm text-emerald-800">Datos cargados en BMW_Labour{info.loadedAt ? ` el ${formatSpanishDateTime(info.loadedAt)}` : ""}.</p>
      {info.canUpload ? <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void upload(event)}>
        <label className="min-w-0 flex-1 text-sm text-zinc-800"><span className="mb-1 block text-xs font-medium text-zinc-600">Listado maestro (.LST o .ZIP)</span>
          <input accept=".lst,.zip" className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:text-sm file:font-medium" ref={fileInput} type="file" />
        </label>
        <button className={`${buttonClass} border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800`} disabled={busy} type="submit">{busy ? "Subiendo…" : "Comparar con .LST"}</button>
      </form> : null}
    </> : null}
    {message ? <p className="text-sm text-emerald-800" role="status">{message}</p> : null}
    {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    {info.comparisons.length ? <ul aria-label="Comparaciones" className="divide-y divide-zinc-100 border-t border-zinc-100">{info.comparisons.map((comparison) => <ComparisonRow comparison={comparison} key={comparison.id} />)}</ul> : null}
  </section>;
}
